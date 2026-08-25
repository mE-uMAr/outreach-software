"""Automation settings, persisted as one JSON document per key.

The settings screen edits a single nested object. Storing it as a document keeps
the schema stable while the shape of the form keeps moving, and reading it is one
row rather than a join across six tables.

Defaults live here rather than in the UI so a fresh install and a returning user
go through exactly the same code path.
"""

from __future__ import annotations

import json
from typing import Any

from ..core import db

AUTOMATION_KEY = "automation"
ONBOARDING_KEY = "onboarding"

#: The weekday rows the schedule card renders, in display order.
_DAYS = (
    ("mon", "Mon", "Monday", True, "send", 20),
    ("tue", "Tue", "Tuesday", True, "send", 20),
    ("wed", "Wed", "Wednesday", True, "send", 20),
    ("thu", "Thu", "Thursday", True, "followup", 20),
    ("fri", "Fri", "Friday", True, "send", 15),
    ("sat", "Sat", "Saturday", False, "none", 0),
    ("sun", "Sun", "Sunday", False, "none", 0),
)

_TEMPLATES = (
    (
        "connection-note",
        "Connection Request Note",
        "Sent with the invitation. LinkedIn caps this at 300 characters.",
        "",
        "Hi {{firstName}} — I follow what {{company}} is doing in {{industry}} and would value "
        "staying connected.",
        300,
    ),
    (
        "first-message",
        "First Message",
        "Sent once the invitation is accepted.",
        "Great to connect, {{firstName}}",
        "Thanks for connecting, {{firstName}}. I work with {{industry}} teams on {{valueProp}} — "
        "happy to share what has been working if that is useful.",
        2000,
    ),
    (
        "second-followup",
        "Second Follow-up",
        "Sent if the first message goes unanswered.",
        "Following up",
        "Hi {{firstName}}, circling back in case this got buried. Worth a short conversation?",
        2000,
    ),
    (
        "third-followup",
        "Third Follow-up",
        "Final touch before the prospect is closed out.",
        "Last note from me",
        "Hi {{firstName}} — I will leave it here, but the door is open if {{valueProp}} becomes "
        "a priority.",
        2000,
    ),
)


def default_settings() -> dict[str, Any]:
    """The settings a brand-new install starts with."""
    return {
        "ai": {"provider": "claude", "model": ""},
        "schedule": [
            {
                "key": key,
                "short": short,
                "full": full,
                "enabled": enabled,
                "action": action,
                "dailyLimit": limit,
            }
            for key, short, full, enabled, action, limit in _DAYS
        ],
        "limits": {"connectionRequests": 20, "postLikes": 15, "postComments": 5},
        "followUps": {
            "secondFollowUpDays": 3,
            "thirdFollowUpDays": 7,
            "autoWithdrawPending": True,
        },
        "templates": [
            {
                "id": identifier,
                "title": title,
                "description": description,
                "subject": subject,
                "body": body,
                "maxChars": max_chars,
            }
            for identifier, title, description, subject, body, max_chars in _TEMPLATES
        ],
        "sheets": {
            "connected": False,
            "name": "",
            "url": "",
            "lastSynced": "",
            "rowsSynced": 0,
            "autoSyncMinutes": 30,
        },
        "browser": {
            # Perception tiers and caching are what keep the automation cheap;
            # see services/browser/agent.py for what each of these does.
            "headless": False,
            "screenshotTier": "on-demand",
            "planCache": True,
            "maxStepsPerTask": 12,
            "fastModel": "haiku",
            "reasoningModel": "sonnet",
        },
    }


def _merge(base: Any, patch: Any) -> Any:
    """Deep-merge a stored document onto the defaults.

    Reading through the defaults means a settings document written by an older
    build gains new keys automatically instead of arriving half-empty in the UI.
    """
    if not isinstance(base, dict) or not isinstance(patch, dict):
        # Lists (the schedule rows, the templates) are replaced wholesale: a
        # per-index merge would resurrect rows the user deliberately removed.
        return patch

    merged = dict(base)
    for key, value in patch.items():
        merged[key] = _merge(base[key], value) if key in base else value
    return merged


def read_document(key: str, fallback: dict[str, Any] | None = None) -> dict[str, Any]:
    with db.connect(readonly=True) as connection:
        row = connection.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ).fetchone()

    if row is None:
        return dict(fallback or {})

    try:
        stored = json.loads(row["value"])
    except json.JSONDecodeError:
        return dict(fallback or {})

    if fallback is None:
        return stored if isinstance(stored, dict) else {}
    return _merge(fallback, stored)


def write_document(key: str, document: dict[str, Any]) -> dict[str, Any]:
    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, json.dumps(document, separators=(",", ":")), db.now()),
        )
    return document


def get_automation() -> dict[str, Any]:
    """Stored automation settings, layered over the defaults."""
    return read_document(AUTOMATION_KEY, default_settings())


def save_automation(settings: dict[str, Any]) -> dict[str, Any]:
    """Persist the settings document and return what was written."""
    merged = _merge(default_settings(), settings)
    return write_document(AUTOMATION_KEY, merged)


def daily_limit_for(settings: dict[str, Any] | None = None) -> int:
    """The connection-request ceiling the planner has to respect."""
    resolved = settings or get_automation()
    limits = resolved.get("limits", {})
    schedule = resolved.get("schedule", [])

    active = [
        int(day.get("dailyLimit", 0))
        for day in schedule
        if day.get("enabled") and day.get("action") in ("send", "followup")
    ]
    ceiling = int(limits.get("connectionRequests", 20))
    if not active:
        return ceiling
    # The per-day rows are the finer-grained control, so the tightest of the two wins.
    return max(1, min(ceiling, max(active)))


def working_days_per_week(settings: dict[str, Any] | None = None) -> int:
    resolved = settings or get_automation()
    days = [
        day
        for day in resolved.get("schedule", [])
        if day.get("enabled") and day.get("action") in ("send", "followup")
    ]
    return max(1, len(days))
