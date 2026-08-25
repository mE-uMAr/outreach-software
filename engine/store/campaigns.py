"""Campaigns, their prospects, and the activity trail.

Every query here is parameterised except the ORDER BY clause, which is chosen
from a fixed map rather than interpolated from caller input.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from ..core import db

#: Campaign lifecycle as the UI understands it.
STATUSES = ("draft", "analyzing", "running", "paused", "completed")

#: Sort keys the table offers, mapped to SQL. Never interpolate caller strings.
_ORDER_BY = {
    "recent": "created_at DESC",
    "name": "name COLLATE NOCASE ASC",
    # A campaign with no target would divide by zero; those sort last.
    "progress": "CASE WHEN target_prospects > 0"
    " THEN CAST(connections_sent AS REAL) / target_prospects ELSE -1 END DESC",
    "prospects": "target_prospects DESC",
}


def _to_public(row: Any) -> dict[str, Any]:
    analysis = None
    if row["analysis"]:
        try:
            analysis = json.loads(row["analysis"])
        except json.JSONDecodeError:
            analysis = None

    return {
        "id": row["id"],
        "name": row["name"],
        "source": row["source"],
        "status": row["status"],
        "searchUrl": row["search_url"],
        "targetProspects": row["target_prospects"],
        "dailyTarget": row["daily_target"],
        "autoPlanned": bool(row["auto_planned"]),
        "connectionsSent": row["connections_sent"],
        "startDate": row["start_date"],
        "estimatedEndDate": row["estimated_end_date"],
        "analysis": analysis,
        "createdAt": row["created_at"],
    }


# ------------------------------------------------------------------ campaigns


def create(
    name: str,
    *,
    account_id: str | None,
    source: str = "sales-navigator",
    search_url: str | None = None,
    target_prospects: int = 0,
    daily_target: int = 0,
    auto_planned: bool = True,
    estimated_end_date: str | None = None,
    analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    identifier = db.new_id("cmp")
    timestamp = db.now()

    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO campaigns (
                id, account_id, name, source, status, search_url, target_prospects,
                daily_target, auto_planned, connections_sent, start_date,
                estimated_end_date, analysis, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
            """,
            (
                identifier,
                account_id,
                name.strip(),
                source,
                search_url,
                int(target_prospects),
                int(daily_target),
                int(bool(auto_planned)),
                estimated_end_date,
                json.dumps(analysis, separators=(",", ":")) if analysis else None,
                timestamp,
                timestamp,
            ),
        )
        row = connection.execute("SELECT * FROM campaigns WHERE id = ?", (identifier,)).fetchone()

    log_activity("campaign", f"Created campaign “{name.strip()}”", campaign_id=identifier)
    return _to_public(row)


def get(campaign_id: str) -> dict[str, Any] | None:
    with db.connect(readonly=True) as connection:
        row = connection.execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()
    return _to_public(row) if row else None


def list_page(
    search: str = "",
    status: str = "all",
    sort: str = "recent",
    page: int = 1,
    page_size: int = 5,
) -> dict[str, Any]:
    clauses: list[str] = []
    params: list[Any] = []

    if status and status != "all":
        clauses.append("status = ?")
        params.append(status)

    term = search.strip()
    if term:
        clauses.append("name LIKE ? ESCAPE '\\'")
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    order = _ORDER_BY.get(sort, _ORDER_BY["recent"])
    page = max(1, int(page))
    page_size = max(1, min(100, int(page_size)))

    with db.connect(readonly=True) as connection:
        total = connection.execute(
            f"SELECT COUNT(*) AS n FROM campaigns {where}", params
        ).fetchone()["n"]
        rows = connection.execute(
            f"SELECT * FROM campaigns {where} ORDER BY {order} LIMIT ? OFFSET ?",
            (*params, page_size, (page - 1) * page_size),
        ).fetchall()

    return {
        "items": [_to_public(row) for row in rows],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


def update(campaign_id: str, **changes: Any) -> dict[str, Any] | None:
    """Patch a campaign. Keys are column names; unknown keys are rejected."""
    columns = {
        "name": "name",
        "status": "status",
        "target_prospects": "target_prospects",
        "daily_target": "daily_target",
        "auto_planned": "auto_planned",
        "connections_sent": "connections_sent",
        "start_date": "start_date",
        "estimated_end_date": "estimated_end_date",
        "search_url": "search_url",
    }

    assignments: list[str] = []
    params: list[Any] = []
    for key, value in changes.items():
        if key not in columns:
            raise ValueError(f"Cannot update unknown campaign field {key!r}")
        assignments.append(f"{columns[key]} = ?")
        params.append(int(value) if isinstance(value, bool) else value)

    if not assignments:
        return get(campaign_id)

    assignments.append("updated_at = ?")
    params.extend([db.now(), campaign_id])

    with db.connect() as connection:
        connection.execute(
            f"UPDATE campaigns SET {', '.join(assignments)} WHERE id = ?", tuple(params)
        )
    return get(campaign_id)


def set_status(campaign_id: str, status: str) -> dict[str, Any] | None:
    if status not in STATUSES:
        raise ValueError(f"Unknown campaign status {status!r}")

    changes: dict[str, Any] = {"status": status}
    # Starting a campaign for the first time is what dates it; a later resume
    # keeps the original start so the pacing maths stays honest.
    if status == "running":
        current = get(campaign_id)
        if current and not current["startDate"]:
            changes["start_date"] = date.today().isoformat()

    updated = update(campaign_id, **changes)
    if updated:
        log_activity("campaign", f"Campaign is now {status}", campaign_id=campaign_id)
    return updated


def delete(campaign_id: str) -> bool:
    with db.connect() as connection:
        cursor = connection.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))
    return cursor.rowcount > 0


def duplicate(campaign_id: str) -> dict[str, Any] | None:
    """Copy a campaign's plan without its progress."""
    source = get(campaign_id)
    if source is None:
        return None

    with db.connect(readonly=True) as connection:
        row = connection.execute(
            "SELECT account_id FROM campaigns WHERE id = ?", (campaign_id,)
        ).fetchone()

    return create(
        f"{source['name']} (copy)",
        account_id=row["account_id"] if row else None,
        source=source["source"],
        search_url=source["searchUrl"],
        target_prospects=source["targetProspects"],
        daily_target=source["dailyTarget"],
        auto_planned=source["autoPlanned"],
        estimated_end_date=source["estimatedEndDate"],
        analysis=source["analysis"],
    )


# ---------------------------------------------------------------------- stats


def _delta(current: int, previous: int) -> str:
    """Human-readable movement against the previous period."""
    if previous == 0:
        return f"+{current}" if current else "No change"
    change = round((current - previous) / previous * 100)
    if change == 0:
        return "No change"
    return f"{'+' if change > 0 else ''}{change}%"


def stats() -> dict[str, Any]:
    """Dashboard tiles, computed from the tables rather than cached."""
    today = date.today().isoformat()

    with db.connect(readonly=True) as connection:
        by_status = {
            row["status"]: row["n"]
            for row in connection.execute("SELECT status, COUNT(*) AS n FROM campaigns GROUP BY status")
        }
        totals = connection.execute(
            "SELECT COUNT(*) AS campaigns, COALESCE(SUM(target_prospects), 0) AS prospects"
            " FROM campaigns"
        ).fetchone()

        sent_today = connection.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE status != 'queued' AND date(invited_at) = ?",
            (today,),
        ).fetchone()["n"]

        # A follow-up is pending once an invite was accepted and the reply has not
        # arrived; the scheduler picks these up in due-date order.
        pending_followups = connection.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE status = 'accepted' AND replied_at IS NULL"
        ).fetchone()["n"]

        created_last_week = connection.execute(
            "SELECT COUNT(*) AS n FROM campaigns WHERE created_at >= datetime('now', '-7 days')"
        ).fetchone()["n"]
        created_week_before = connection.execute(
            "SELECT COUNT(*) AS n FROM campaigns"
            " WHERE created_at >= datetime('now', '-14 days')"
            "   AND created_at <  datetime('now', '-7 days')"
        ).fetchone()["n"]

        sent_yesterday = connection.execute(
            "SELECT COUNT(*) AS n FROM prospects"
            " WHERE status != 'queued' AND date(invited_at) = date('now', '-1 day')"
        ).fetchone()["n"]

    active = by_status.get("running", 0) + by_status.get("analyzing", 0)
    completed = by_status.get("completed", 0)

    return {
        "totalCampaigns": totals["campaigns"],
        "activeCampaigns": active,
        "completedCampaigns": completed,
        "totalProspects": totals["prospects"],
        "connectionsSentToday": sent_today,
        "pendingFollowUps": pending_followups,
        "deltas": {
            "totalCampaigns": _delta(created_last_week, created_week_before),
            "activeCampaigns": f"{active} live now" if active else "None running",
            "completedCampaigns": f"{completed} finished" if completed else "None yet",
            "totalProspects": f"{totals['prospects']:,} queued",
            "connectionsSentToday": _delta(sent_today, sent_yesterday),
            "pendingFollowUps": f"{pending_followups} awaiting reply"
            if pending_followups
            else "All clear",
        },
    }


# ------------------------------------------------------------------ prospects


def add_prospects(campaign_id: str, prospects: list[dict[str, Any]]) -> int:
    """Queue prospects, ignoring anyone already on this campaign.

    Returns how many rows were genuinely new.
    """
    if not prospects:
        return 0

    timestamp = db.now()
    rows = [
        (
            db.new_id("psp"),
            campaign_id,
            person.get("memberUrn"),
            person.get("publicId"),
            person.get("fullName") or "",
            person.get("headline"),
            person.get("company"),
            person.get("location"),
            person["profileUrl"],
            timestamp,
            timestamp,
        )
        for person in prospects
        if person.get("profileUrl")
    ]

    with db.connect() as connection:
        before = connection.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()["n"]
        connection.executemany(
            """
            INSERT OR IGNORE INTO prospects (
                id, campaign_id, member_urn, public_id, full_name, headline,
                company, location, profile_url, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        after = connection.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()["n"]

    return after - before


def list_prospects(campaign_id: str, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    clauses = ["campaign_id = ?"]
    params: list[Any] = [campaign_id]
    if status:
        clauses.append("status = ?")
        params.append(status)

    with db.connect(readonly=True) as connection:
        rows = connection.execute(
            f"SELECT * FROM prospects WHERE {' AND '.join(clauses)}"
            " ORDER BY created_at ASC LIMIT ?",
            (*params, max(1, min(1000, limit))),
        ).fetchall()

    return [
        {
            "id": row["id"],
            "fullName": row["full_name"],
            "headline": row["headline"],
            "company": row["company"],
            "location": row["location"],
            "profileUrl": row["profile_url"],
            "status": row["status"],
            "invitedAt": row["invited_at"],
            "acceptedAt": row["accepted_at"],
            "repliedAt": row["replied_at"],
            "followupsSent": row["followups_sent"],
            "error": row["error"],
        }
        for row in rows
    ]


def mark_prospect(prospect_id: str, status: str, error: str | None = None) -> None:
    """Advance a prospect and stamp the matching timestamp column."""
    stamp_column = {
        "invited": "invited_at",
        "accepted": "accepted_at",
        "replied": "replied_at",
    }.get(status)

    assignments = ["status = ?", "updated_at = ?", "error = ?"]
    params: list[Any] = [status, db.now(), error]
    if stamp_column:
        assignments.append(f"{stamp_column} = ?")
        params.append(db.now())
    params.append(prospect_id)

    with db.connect() as connection:
        connection.execute(
            f"UPDATE prospects SET {', '.join(assignments)} WHERE id = ?", tuple(params)
        )


def recount_sent(campaign_id: str) -> int:
    """Re-derive `connections_sent` from the prospect rows and store it.

    The counter is denormalised for the table view; deriving it here keeps it from
    drifting away from the rows it summarises.
    """
    with db.connect() as connection:
        sent = connection.execute(
            "SELECT COUNT(*) AS n FROM prospects WHERE campaign_id = ? AND status != 'queued'",
            (campaign_id,),
        ).fetchone()["n"]
        connection.execute(
            "UPDATE campaigns SET connections_sent = ?, updated_at = ? WHERE id = ?",
            (sent, db.now(), campaign_id),
        )
    return sent


# ------------------------------------------------------------------- activity


def log_activity(
    kind: str,
    message: str,
    *,
    campaign_id: str | None = None,
    prospect_id: str | None = None,
    detail: Any = None,
) -> None:
    with db.connect() as connection:
        connection.execute(
            "INSERT INTO activity_log (campaign_id, prospect_id, kind, message, detail, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                campaign_id,
                prospect_id,
                kind,
                message,
                json.dumps(detail, separators=(",", ":"), default=str) if detail else None,
                db.now(),
            ),
        )


def recent_activity(limit: int = 50, campaign_id: str | None = None) -> list[dict[str, Any]]:
    clause = "WHERE campaign_id = ?" if campaign_id else ""
    params: tuple[Any, ...] = (campaign_id, limit) if campaign_id else (limit,)

    with db.connect(readonly=True) as connection:
        rows = connection.execute(
            f"SELECT * FROM activity_log {clause} ORDER BY created_at DESC, id DESC LIMIT ?",
            params,
        ).fetchall()

    return [
        {
            "id": row["id"],
            "campaignId": row["campaign_id"],
            "prospectId": row["prospect_id"],
            "kind": row["kind"],
            "message": row["message"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def working_day_end(start: date, working_days: int, days_per_week: int) -> str:
    """Project a completion date, counting only the days the schedule runs on.

    Five working days a week means a 10-day campaign lands two calendar weeks
    out, not ten days out.
    """
    if working_days <= 0:
        return start.isoformat()

    per_week = max(1, min(7, days_per_week))
    whole_weeks, remainder = divmod(working_days, per_week)
    calendar_days = whole_weeks * 7 + remainder
    return (start + timedelta(days=calendar_days)).isoformat()
