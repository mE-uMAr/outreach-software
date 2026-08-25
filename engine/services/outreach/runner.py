"""Running a campaign.

One task per running campaign. Each one works through its queued prospects,
sending connection requests inside the operator's own schedule and limits, and
stops the moment anything looks wrong.

The pacing is not decoration. LinkedIn restricts accounts that behave like
software: a fixed interval between actions, work at 3am, hundreds of invitations
in an hour. So the runner only acts inside the configured days, never exceeds the
daily ceiling, and spaces actions with a randomised gap. Getting the user's
account restricted would be a far worse failure than being slow.

Every send goes through the browser agent, which means the second prospect
onwards costs nothing to decide — the invite flow is the same three pages every
time, and the plan cache has already learned them.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from ...core import db
from ...core.logging import get_logger
from ...store import campaigns as store
from ...store import settings_store
from ..browser.agent import BrowserAgent
from ..browser.runtime import runtime
from . import drafting

log = get_logger(__name__)

#: Seconds between two invitations, before jitter. Roughly 20-40 an hour at the
#: low end, which is inside what a busy human plausibly does.
BASE_DELAY_SECONDS = 95
#: Random spread applied to every delay, as a fraction. No two gaps are alike.
DELAY_JITTER = 0.55

#: How long to wait before re-checking a schedule that is currently closed.
SCHEDULE_POLL_SECONDS = 300

#: Consecutive failures before a campaign pauses itself. A run that keeps failing
#: is usually a changed page or a challenged account, and continuing to hammer it
#: helps nobody.
MAX_CONSECUTIVE_FAILURES = 3

_DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


@dataclass(slots=True)
class RunnerState:
    campaign_id: str
    status: str = "idle"
    sent_today: int = 0
    daily_target: int = 0
    last_message: str = ""
    last_error: str | None = None
    started_at: float = 0.0
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "campaignId": self.campaign_id,
            "status": self.status,
            "sentToday": self.sent_today,
            "dailyTarget": self.daily_target,
            "lastMessage": self.last_message,
            "lastError": self.last_error,
            "startedAt": self.started_at,
        }


def _today_window(settings: dict[str, Any]) -> dict[str, Any] | None:
    """The schedule row for today, or None when today is not a working day."""
    key = _DAY_KEYS[datetime.now().weekday()]
    for row in settings.get("schedule", []):
        if row.get("key") == key:
            if row.get("enabled") and row.get("action") in ("send", "followup"):
                return row
            return None
    return None


def _sent_today(campaign_id: str) -> int:
    with db.connect(readonly=True) as connection:
        return connection.execute(
            "SELECT COUNT(*) AS n FROM prospects"
            " WHERE campaign_id = ? AND invited_at IS NOT NULL AND date(invited_at) = ?",
            (campaign_id, date.today().isoformat()),
        ).fetchone()["n"]


def _next_prospect(campaign_id: str) -> dict[str, Any] | None:
    with db.connect(readonly=True) as connection:
        row = connection.execute(
            "SELECT * FROM prospects WHERE campaign_id = ? AND status = 'queued'"
            " ORDER BY created_at ASC LIMIT 1",
            (campaign_id,),
        ).fetchone()

    if row is None:
        return None
    return {
        "id": row["id"],
        "fullName": row["full_name"],
        "headline": row["headline"],
        "company": row["company"],
        "location": row["location"],
        "profileUrl": row["profile_url"],
    }


def _delay() -> float:
    """A randomised gap, never the same twice."""
    spread = BASE_DELAY_SECONDS * DELAY_JITTER
    return max(20.0, random.uniform(BASE_DELAY_SECONDS - spread, BASE_DELAY_SECONDS + spread))


class CampaignRunner:
    """Owns the running campaigns."""

    def __init__(self) -> None:
        self._states: dict[str, RunnerState] = {}
        self._notify: Any = None

    def set_notifier(self, notify: Any) -> None:
        """Where progress goes. Set once by the RPC layer at start-up."""
        self._notify = notify

    def _emit(self, campaign_id: str, event: str, **payload: Any) -> None:
        state = self._states.get(campaign_id)
        if state:
            state.last_message = str(payload.get("message") or state.last_message)
        if self._notify:
            self._notify(f"campaign.{event}", {"campaignId": campaign_id, **payload})

    def state(self, campaign_id: str) -> dict[str, Any] | None:
        found = self._states.get(campaign_id)
        return found.to_dict() if found else None

    def all_states(self) -> list[dict[str, Any]]:
        return [state.to_dict() for state in self._states.values()]

    def is_running(self, campaign_id: str) -> bool:
        state = self._states.get(campaign_id)
        return bool(state and state.task and not state.task.done())

    async def start(self, campaign_id: str) -> dict[str, Any]:
        """Begin working a campaign, or return the run already in progress."""
        if self.is_running(campaign_id):
            return self._states[campaign_id].to_dict()

        campaign = store.get(campaign_id)
        if campaign is None:
            raise ValueError(f"No campaign {campaign_id!r}")

        state = RunnerState(
            campaign_id=campaign_id,
            status="starting",
            daily_target=campaign["dailyTarget"],
            sent_today=_sent_today(campaign_id),
            started_at=datetime.now(UTC).timestamp(),
        )
        self._states[campaign_id] = state

        store.set_status(campaign_id, "running")
        state.task = asyncio.create_task(self._run(campaign_id), name=f"campaign:{campaign_id}")
        return state.to_dict()

    async def stop(self, campaign_id: str) -> dict[str, Any]:
        """Stop a run. In-flight work is allowed to finish its current step."""
        state = self._states.get(campaign_id)
        if state and state.task and not state.task.done():
            state.status = "stopping"
            state.task.cancel()
            try:
                await state.task
            except asyncio.CancelledError:
                pass

        store.set_status(campaign_id, "paused")
        if state:
            state.status = "paused"
        self._emit(campaign_id, "stopped", message="Campaign paused")
        return {"campaignId": campaign_id, "status": "paused"}

    async def stop_all(self) -> None:
        for campaign_id in list(self._states):
            await self.stop(campaign_id)

    # -------------------------------------------------------------- the loop

    async def _run(self, campaign_id: str) -> None:
        state = self._states[campaign_id]
        failures = 0

        try:
            while True:
                campaign = store.get(campaign_id)
                if campaign is None or campaign["status"] != "running":
                    self._emit(campaign_id, "stopped", message="Campaign is no longer running")
                    return

                settings = settings_store.get_automation()
                window = _today_window(settings)
                if window is None:
                    state.status = "waiting"
                    self._emit(
                        campaign_id,
                        "waiting",
                        message="Outside the days this campaign runs on — waiting.",
                    )
                    await asyncio.sleep(SCHEDULE_POLL_SECONDS)
                    continue

                ceiling = min(
                    int(window.get("dailyLimit") or 0) or campaign["dailyTarget"],
                    campaign["dailyTarget"] or int(window.get("dailyLimit") or 0),
                    settings_store.daily_limit_for(settings),
                )
                state.daily_target = ceiling
                state.sent_today = _sent_today(campaign_id)

                if state.sent_today >= ceiling:
                    state.status = "quota-reached"
                    self._emit(
                        campaign_id,
                        "quota",
                        message=f"Today's limit of {ceiling} invitations is done.",
                        sentToday=state.sent_today,
                    )
                    await asyncio.sleep(SCHEDULE_POLL_SECONDS)
                    continue

                prospect = _next_prospect(campaign_id)
                if prospect is None:
                    store.set_status(campaign_id, "completed")
                    state.status = "completed"
                    self._emit(campaign_id, "completed", message="Every prospect has been worked.")
                    return

                state.status = "working"
                self._emit(
                    campaign_id,
                    "progress",
                    message=f"Inviting {prospect['fullName']}",
                    prospectId=prospect["id"],
                    sentToday=state.sent_today,
                    dailyTarget=ceiling,
                )

                ok, detail = await self._invite(campaign, prospect, settings)

                if ok:
                    failures = 0
                    state.sent_today += 1
                    store.mark_prospect(prospect["id"], "invited")
                    store.log_activity(
                        "invite",
                        f"Invitation sent to {prospect['fullName']}",
                        campaign_id=campaign_id,
                        prospect_id=prospect["id"],
                    )
                else:
                    failures += 1
                    state.last_error = detail
                    store.mark_prospect(prospect["id"], "failed", error=detail)
                    store.log_activity(
                        "error",
                        f"Could not invite {prospect['fullName']}: {detail}",
                        campaign_id=campaign_id,
                        prospect_id=prospect["id"],
                    )

                store.recount_sent(campaign_id)

                if failures >= MAX_CONSECUTIVE_FAILURES:
                    store.set_status(campaign_id, "paused")
                    state.status = "paused"
                    self._emit(
                        campaign_id,
                        "paused",
                        message=(
                            f"Paused after {failures} failures in a row. "
                            "Check the account in Settings."
                        ),
                        error=state.last_error,
                    )
                    return

                await asyncio.sleep(_delay())

        except asyncio.CancelledError:
            state.status = "paused"
            raise
        except Exception as error:  # pragma: no cover - defensive
            log.exception("Campaign %s crashed", campaign_id)
            state.status = "failed"
            state.last_error = str(error)
            store.set_status(campaign_id, "paused")
            self._emit(campaign_id, "failed", message=str(error))

    async def _invite(
        self, campaign: dict[str, Any], prospect: dict[str, Any], settings: dict[str, Any]
    ) -> tuple[bool, str]:
        """Send one connection request, with a note if the operator wrote one."""
        note = ""
        template = next(
            (
                item
                for item in settings.get("templates", [])
                if item.get("id") == "connection-note"
            ),
            None,
        )
        if template and template.get("body", "").strip():
            try:
                note = await drafting.connection_note(template, prospect, campaign)
            except Exception as error:
                # A note is an enhancement; sending without one beats not sending.
                log.warning("Falling back to no connection note: %s", error)

        page = await runtime.page(headless=settings.get("browser", {}).get("headless", False))

        try:
            await page.goto(prospect["profileUrl"], wait_until="domcontentloaded", timeout=45_000)
        except Exception as error:
            return False, f"Could not open the profile: {str(error).splitlines()[0][:150]}"

        goal = (
            "Send a connection request to this person. Click Connect (it may be behind a "
            "More button). If a note is offered, add the note given in the context, then "
            "send. Answer done once the request has been sent, or fail if this person "
            "cannot be invited."
        )
        context = f"Note to add:\n{note}" if note else "Send without a note."

        agent = BrowserAgent(page, max_steps=8)
        result = await agent.run(goal, context=context)
        return result.ok, result.summary or "The invitation could not be confirmed"


#: One runner for the process.
runner = CampaignRunner()
