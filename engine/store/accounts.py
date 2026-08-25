"""The signed-in LinkedIn account and its browser session.

Exactly one account is active at a time. The row carries both the profile the UI
shows and the encrypted `storage_state` the automation replays to stay signed in,
so a restart resumes the session instead of asking the user to log in again.
"""

from __future__ import annotations

import json
from typing import Any

from ..core import db, secrets
from ..core.logging import get_logger

log = get_logger(__name__)

#: Row lifecycle. `expired` means the cookies stopped working and the user has to
#: sign in again; the profile is kept so the UI can name who needs re-authorising.
STATUS_CONNECTED = "connected"
STATUS_EXPIRED = "expired"


def _to_public(row: Any) -> dict[str, Any]:
    """Row → the shape the renderer consumes. Never includes the session."""
    return {
        "id": row["id"],
        "memberUrn": row["member_urn"],
        "publicId": row["public_id"],
        "fullName": row["full_name"],
        "headline": row["headline"],
        "email": row["email"],
        "location": row["location"],
        "avatarUrl": row["avatar_url"],
        "profileUrl": row["profile_url"],
        "premium": bool(row["premium"]),
        "salesNavigator": bool(row["sales_navigator"]),
        "status": row["status"],
        "lastVerifiedAt": row["last_verified_at"],
        "createdAt": row["created_at"],
    }


def get_active() -> dict[str, Any] | None:
    """The account the app is working as, if any."""
    with db.connect(readonly=True) as connection:
        row = connection.execute(
            "SELECT * FROM linkedin_accounts ORDER BY updated_at DESC LIMIT 1"
        ).fetchone()
    return _to_public(row) if row else None


def save(profile: dict[str, Any], storage_state: dict[str, Any] | None) -> dict[str, Any]:
    """Insert or update the account, encrypting the session on the way in.

    Matching is on `member_urn` — the one identifier LinkedIn does not change when
    a user renames themselves or edits their public profile slug.
    """
    urn = profile.get("memberUrn") or profile.get("publicId")
    if not urn:
        raise ValueError("A LinkedIn account needs at least a member URN or public id")

    blob = secrets.encrypt(json.dumps(storage_state)) if storage_state is not None else None
    timestamp = db.now()

    with db.connect() as connection:
        existing = connection.execute(
            "SELECT id FROM linkedin_accounts WHERE member_urn = ?", (urn,)
        ).fetchone()

        fields = {
            "member_urn": urn,
            "public_id": profile.get("publicId"),
            "full_name": profile.get("fullName") or "",
            "headline": profile.get("headline") or "",
            "email": profile.get("email"),
            "location": profile.get("location"),
            "avatar_url": profile.get("avatarUrl"),
            "profile_url": profile.get("profileUrl"),
            "premium": int(bool(profile.get("premium"))),
            "sales_navigator": int(bool(profile.get("salesNavigator"))),
            "status": STATUS_CONNECTED,
            "last_verified_at": timestamp,
            "updated_at": timestamp,
        }

        if existing:
            identifier = existing["id"]
            # A refresh that could not capture a session must not blank the one
            # already stored, so the blob is only written when we actually have one.
            if blob is not None:
                fields["storage_state"] = blob
            assignments = ", ".join(f"{column} = ?" for column in fields)
            connection.execute(
                f"UPDATE linkedin_accounts SET {assignments} WHERE id = ?",
                (*fields.values(), identifier),
            )
        else:
            identifier = db.new_id("li")
            fields |= {"id": identifier, "storage_state": blob, "created_at": timestamp}
            columns = ", ".join(fields)
            placeholders = ", ".join("?" for _ in fields)
            connection.execute(
                f"INSERT INTO linkedin_accounts ({columns}) VALUES ({placeholders})",
                tuple(fields.values()),
            )

        row = connection.execute(
            "SELECT * FROM linkedin_accounts WHERE id = ?", (identifier,)
        ).fetchone()

    log.info("Stored LinkedIn account %s (%s)", fields["full_name"], identifier)
    return _to_public(row)


def load_storage_state() -> dict[str, Any] | None:
    """Decrypt the stored browser session for replay into a new context."""
    with db.connect(readonly=True) as connection:
        row = connection.execute(
            "SELECT storage_state FROM linkedin_accounts"
            " WHERE status = ? ORDER BY updated_at DESC LIMIT 1",
            (STATUS_CONNECTED,),
        ).fetchone()

    if row is None or row["storage_state"] is None:
        return None

    raw = secrets.try_decrypt(row["storage_state"])
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        log.warning("Stored LinkedIn session is not valid JSON; ignoring it")
        return None


def update_storage_state(storage_state: dict[str, Any]) -> None:
    """Refresh the stored session after a run, so rotated cookies are kept."""
    with db.connect() as connection:
        connection.execute(
            "UPDATE linkedin_accounts SET storage_state = ?, last_verified_at = ?, updated_at = ?"
            " WHERE id = (SELECT id FROM linkedin_accounts ORDER BY updated_at DESC LIMIT 1)",
            (secrets.encrypt(json.dumps(storage_state)), db.now(), db.now()),
        )


def mark_expired(reason: str | None = None) -> None:
    """Flag the session as no longer usable without discarding the profile."""
    with db.connect() as connection:
        connection.execute(
            "UPDATE linkedin_accounts SET status = ?, storage_state = NULL, updated_at = ?"
            " WHERE id = (SELECT id FROM linkedin_accounts ORDER BY updated_at DESC LIMIT 1)",
            (STATUS_EXPIRED, db.now()),
        )
    log.info("LinkedIn session marked expired%s", f": {reason}" if reason else "")


def disconnect() -> bool:
    """Forget the account entirely — profile, session and every campaign under it."""
    with db.connect() as connection:
        cursor = connection.execute("DELETE FROM linkedin_accounts")
    return cursor.rowcount > 0
