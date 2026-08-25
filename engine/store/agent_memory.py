"""What the browser agent remembers between runs.

Two tables, both there to stop the app paying for the same thinking twice:

* ``agent_plans`` — a page signature mapped to the action that worked on it. A
  LinkedIn search page has the same accessibility structure every time it loads,
  so the second visit costs nothing at all.
* ``ai_usage`` — every model call with its tokens and cost, so the price of a
  campaign is a number the user can read rather than a surprise on a bill.

A plan that starts failing is evicted rather than retried forever: LinkedIn ships
UI changes, and a stale cache entry must degrade into one model call, not into a
stuck automation.
"""

from __future__ import annotations

import json
from typing import Any

from ..core import db
from ..core.logging import get_logger

log = get_logger(__name__)

#: Consecutive failures after which a cached plan is dropped.
MAX_PLAN_FAILURES = 2


def remember_plan(signature: str, goal: str, plan: dict[str, Any], model: str | None) -> None:
    """Store the action that solved this page, or refresh one already stored."""
    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO agent_plans (signature, goal, url_pattern, plan, model, hits,
                                     failures, last_used_at, created_at)
            VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
            ON CONFLICT(signature) DO UPDATE SET
                plan = excluded.plan,
                model = excluded.model,
                failures = 0,
                last_used_at = excluded.last_used_at
            """,
            (
                signature,
                goal,
                plan.get("urlPattern"),
                json.dumps(plan, separators=(",", ":")),
                model,
                db.now(),
                db.now(),
            ),
        )


def recall_plan(signature: str, goal: str) -> dict[str, Any] | None:
    """Look up a cached action, counting the hit."""
    with db.connect() as connection:
        row = connection.execute(
            "SELECT plan, failures FROM agent_plans WHERE signature = ? AND goal = ?",
            (signature, goal),
        ).fetchone()

        if row is None or row["failures"] >= MAX_PLAN_FAILURES:
            return None

        connection.execute(
            "UPDATE agent_plans SET hits = hits + 1, last_used_at = ? WHERE signature = ?",
            (db.now(), signature),
        )

    try:
        return json.loads(row["plan"])
    except json.JSONDecodeError:
        return None


def record_plan_failure(signature: str) -> None:
    """A cached plan did not work; evict it once it has failed enough times."""
    with db.connect() as connection:
        connection.execute(
            "UPDATE agent_plans SET failures = failures + 1 WHERE signature = ?", (signature,)
        )
        connection.execute(
            "DELETE FROM agent_plans WHERE signature = ? AND failures >= ?",
            (signature, MAX_PLAN_FAILURES),
        )


def forget_plans(goal: str | None = None) -> int:
    """Clear the plan cache, wholly or for one goal."""
    with db.connect() as connection:
        cursor = (
            connection.execute("DELETE FROM agent_plans WHERE goal = ?", (goal,))
            if goal
            else connection.execute("DELETE FROM agent_plans")
        )
    return cursor.rowcount


def record_usage(
    purpose: str,
    *,
    model: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: float = 0.0,
    cache_hit: bool = False,
    had_screenshot: bool = False,
    duration_ms: int = 0,
) -> None:
    with db.connect() as connection:
        connection.execute(
            """
            INSERT INTO ai_usage (at, purpose, model, input_tokens, output_tokens,
                                  cost_usd, cache_hit, had_screenshot, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                db.now(),
                purpose,
                model,
                int(input_tokens),
                int(output_tokens),
                float(cost_usd or 0.0),
                int(cache_hit),
                int(had_screenshot),
                int(duration_ms),
            ),
        )


def usage_summary(days: int = 30) -> dict[str, Any]:
    """Spend and cache effectiveness over a window."""
    with db.connect(readonly=True) as connection:
        totals = connection.execute(
            """
            SELECT COUNT(*)                AS calls,
                   COALESCE(SUM(cost_usd), 0)      AS cost,
                   COALESCE(SUM(input_tokens), 0)  AS input_tokens,
                   COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(cache_hit), 0)     AS cache_hits,
                   COALESCE(SUM(had_screenshot), 0) AS screenshots,
                   COALESCE(AVG(duration_ms), 0)   AS avg_duration
            FROM ai_usage
            WHERE at >= datetime('now', ?)
            """,
            (f"-{max(1, int(days))} days",),
        ).fetchone()

        by_purpose = [
            {"purpose": row["purpose"], "calls": row["calls"], "costUsd": round(row["cost"], 4)}
            for row in connection.execute(
                "SELECT purpose, COUNT(*) AS calls, COALESCE(SUM(cost_usd), 0) AS cost"
                " FROM ai_usage WHERE at >= datetime('now', ?)"
                " GROUP BY purpose ORDER BY cost DESC",
                (f"-{max(1, int(days))} days",),
            )
        ]

        cached = connection.execute(
            "SELECT COUNT(*) AS plans, COALESCE(SUM(hits), 0) AS hits FROM agent_plans"
        ).fetchone()

    calls = totals["calls"]
    return {
        "windowDays": days,
        "calls": calls,
        "costUsd": round(totals["cost"], 4),
        "inputTokens": totals["input_tokens"],
        "outputTokens": totals["output_tokens"],
        # Model calls avoided entirely, expressed against the work that was asked
        # for rather than the work that was billed.
        "cacheHits": cached["hits"],
        "cacheHitRate": round(cached["hits"] / (cached["hits"] + calls), 3)
        if (cached["hits"] + calls)
        else 0.0,
        "cachedPlans": cached["plans"],
        "screenshotCalls": totals["screenshots"],
        "screenshotRate": round(totals["screenshots"] / calls, 3) if calls else 0.0,
        "avgDurationMs": round(totals["avg_duration"]),
        "byPurpose": by_purpose,
    }
