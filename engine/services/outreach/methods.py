"""outreach.* methods — campaigns, settings, onboarding and message drafting.

This is the namespace the UI spends nearly all of its time in. Everything here
reads and writes the database; nothing is held in memory between calls, so the
app survives an engine restart with no visible state loss.
"""

from __future__ import annotations

from typing import Any

from ...core.logging import get_logger
from ...rpc.protocol import InvalidParams, RpcException
from ...rpc.registry import method
from ...rpc.server import RpcContext
from ...store import accounts, agent_memory, settings_store
from ...store import campaigns as store
from ..ai import auth as claude_auth
from ..browser.runtime import runtime_status
from ..linkedin import search
from . import drafting
from .runner import runner

log = get_logger(__name__)


# ----------------------------------------------------------------- onboarding


@method("outreach.readiness")
async def outreach_readiness() -> dict[str, Any]:
    """Everything the app needs before it can do any work.

    The UI gates on this: campaigns are not reachable until both the AI and the
    LinkedIn account are connected, because every part of a campaign depends on
    one or the other.
    """
    claude = await claude_auth.status()
    account = accounts.get_active()
    browser = runtime_status()

    linkedin_ready = bool(account and account["status"] == "connected")
    ai_ready = bool(claude.get("loggedIn"))

    return {
        "ready": ai_ready and linkedin_ready,
        "ai": {
            "ready": ai_ready,
            "installed": bool(claude.get("installed")),
            "email": claude.get("email"),
            "plan": claude.get("plan"),
            "organization": claude.get("organization"),
            "error": claude.get("error"),
        },
        "linkedin": {"ready": linkedin_ready, "account": account},
        "browser": {
            "ready": bool(browser.get("installed")),
            "reason": browser.get("reason"),
            "message": browser.get("message"),
        },
        # The browser can be installed after onboarding — it is only needed once a
        # campaign actually runs — so it is reported but does not gate entry.
        "blocking": [
            name
            for name, ok in (("ai", ai_ready), ("linkedin", linkedin_ready))
            if not ok
        ],
    }


# ------------------------------------------------------------------- settings


@method("outreach.getSettings")
def outreach_get_settings() -> dict[str, Any]:
    """Automation settings, layered over the defaults."""
    return settings_store.get_automation()


@method("outreach.saveSettings")
def outreach_save_settings(settings: dict[str, Any]) -> dict[str, Any]:
    """Persist the settings document."""
    if not isinstance(settings, dict):
        raise InvalidParams("`settings` must be an object")
    return settings_store.save_automation(settings)


# ------------------------------------------------------------------ campaigns


@method("outreach.stats")
def outreach_stats() -> dict[str, Any]:
    """Dashboard tiles, computed from the tables."""
    return store.stats()


@method("outreach.listCampaigns")
def outreach_list_campaigns(
    search: str = "",
    status: str = "all",
    sort: str = "recent",
    page: int = 1,
    pageSize: int = 5,  # noqa: N803 - the wire contract is camelCase
) -> dict[str, Any]:
    """One page of campaigns, filtered and sorted."""
    return store.list_page(search=search, status=status, sort=sort, page=page, page_size=pageSize)


@method("outreach.getCampaign")
def outreach_get_campaign(id: str) -> dict[str, Any] | None:  # noqa: A002
    """A single campaign, or null."""
    return store.get(id)


@method("outreach.createCampaign")
def outreach_create_campaign(
    name: str,
    analysis: dict[str, Any] | None = None,
    source: str = "sales-navigator",
    searchUrl: str | None = None,  # noqa: N803
    targetProspects: int = 0,  # noqa: N803
    dailyTarget: int = 0,  # noqa: N803
    autoPlanned: bool = True,  # noqa: N803
    estimatedEndDate: str | None = None,  # noqa: N803
) -> dict[str, Any]:
    """Create a campaign from an approved plan."""
    if not name.strip():
        raise InvalidParams("A campaign needs a name")

    account = accounts.get_active()
    return store.create(
        name,
        account_id=account["id"] if account else None,
        source=source,
        search_url=searchUrl,
        target_prospects=targetProspects,
        daily_target=dailyTarget,
        auto_planned=autoPlanned,
        estimated_end_date=estimatedEndDate,
        analysis=analysis,
    )


@method("outreach.updateCampaign")
def outreach_update_campaign(id: str, changes: dict[str, Any]) -> dict[str, Any] | None:  # noqa: A002
    """Rename or re-pace a campaign."""
    mapping = {
        "name": "name",
        "dailyTarget": "daily_target",
        "targetProspects": "target_prospects",
        "autoPlanned": "auto_planned",
        "estimatedEndDate": "estimated_end_date",
    }
    translated = {mapping[key]: value for key, value in changes.items() if key in mapping}
    if not translated:
        raise InvalidParams(f"Nothing updatable in {sorted(changes)}")
    return store.update(id, **translated)


@method("outreach.setCampaignStatus")
async def outreach_set_campaign_status(
    ctx: RpcContext,
    id: str,  # noqa: A002
    status: str,
) -> dict[str, Any] | None:
    """Start, pause, resume or complete a campaign.

    Starting one launches the runner, which then works the queue on its own and
    reports through `campaign.*` notifications.
    """
    # The runner outlives any single request, so it is given the server's
    # notifier rather than a per-call context.
    runner.set_notifier(ctx.notify)

    try:
        if status == "running":
            await runner.start(id)
            return store.get(id)
        if status in ("paused", "completed"):
            await runner.stop(id)
            return store.set_status(id, status)
        return store.set_status(id, status)
    except ValueError as error:
        raise InvalidParams(str(error)) from error


@method("outreach.runnerState")
def outreach_runner_state(campaignId: str | None = None) -> Any:  # noqa: N803
    """What the runner is doing right now."""
    return runner.state(campaignId) if campaignId else runner.all_states()


@method("outreach.deleteCampaign")
def outreach_delete_campaign(id: str) -> dict[str, Any]:  # noqa: A002
    """Delete a campaign and everything queued under it."""
    return {"deleted": store.delete(id)}


@method("outreach.duplicateCampaign")
def outreach_duplicate_campaign(id: str) -> dict[str, Any] | None:  # noqa: A002
    """Copy a campaign's plan without its progress."""
    return store.duplicate(id)


@method("outreach.listProspects")
def outreach_list_prospects(
    campaignId: str,  # noqa: N803
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """The people queued against a campaign."""
    return store.list_prospects(campaignId, status, limit)


@method("outreach.activity")
def outreach_activity(limit: int = 50, campaignId: str | None = None) -> list[dict[str, Any]]:  # noqa: N803
    """Recent activity, newest first."""
    return store.recent_activity(limit, campaignId)


# ------------------------------------------------------------------- analysis


@method("outreach.analyzeSearch")
async def outreach_analyze_search(ctx: RpcContext, url: str) -> dict[str, Any]:
    """Read a LinkedIn search and plan a campaign from it.

    Mirrors `linkedin.analyzeSearch`; kept in this namespace because it is what
    the create-campaign flow calls.
    """

    def on_progress(step: dict[str, Any]) -> None:
        ctx.progress(step["label"], percent=step["progress"] * 100, step=step)

    return await search.analyze(url, on_progress)


@method("outreach.validateSearchUrl")
def outreach_validate_search_url(url: str) -> dict[str, Any]:
    """Whether a URL is a search this app can work with."""
    try:
        return {"valid": True, "source": search.classify_url(url)}
    except RpcException as error:
        return {"valid": False, "source": None, "message": error.message}


# ------------------------------------------------------------------- drafting


DRAFT_SYSTEM = """You write short LinkedIn outreach messages for a real \
salesperson's account.

Rules:
- Sound like a person, not a marketing email. No "I hope this finds you well".
- Use the prospect's own details; never invent a fact about them.
- Respect the character limit exactly — a connection note over 300 characters \
is rejected by LinkedIn.
- No emoji unless the operator's own template uses them.
- Keep the operator's template as the intent; you are adapting it, not \
replacing it.

Reply with a single JSON object: {"message": "...", "characters": <int>}"""


@method("outreach.draftMessage")
async def outreach_draft_message(
    templateId: str,  # noqa: N803
    prospect: dict[str, Any],
    campaignId: str | None = None,  # noqa: N803
) -> dict[str, Any]:
    """Adapt one of the operator's templates to one prospect.

    The same path the runner uses when it sends, so a preview here is exactly
    what a prospect would receive.
    """
    settings = settings_store.get_automation()
    template = next(
        (item for item in settings.get("templates", []) if item.get("id") == templateId), None
    )
    if template is None:
        raise InvalidParams(f"Unknown template {templateId!r}")

    campaign = store.get(campaignId) if campaignId else None
    message = await drafting.personalise(template, prospect, campaign)
    if not message:
        raise RpcException("That template is empty — write one first.")

    return {"message": message, "characters": len(message), "templateId": templateId}


@method("outreach.usage")
def outreach_usage(days: int = 30) -> dict[str, Any]:
    """What the AI has cost over a window, and how much the cache saved."""
    return agent_memory.usage_summary(days)
