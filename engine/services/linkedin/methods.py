"""linkedin.* methods — account connection and search analysis."""

from __future__ import annotations

from typing import Any

from ...rpc.registry import method
from ...rpc.server import RpcContext
from ...store import accounts
from . import auth, search


@method("linkedin.status")
async def linkedin_status(deep: bool = False) -> dict[str, Any]:
    """Whether a LinkedIn account is connected. `deep` verifies against LinkedIn."""
    return await auth.status(deep=deep)


@method("linkedin.login")
async def linkedin_login(ctx: RpcContext) -> dict[str, Any]:
    """Open a browser window for the user to sign in to LinkedIn.

    Progress arrives as `linkedin.login.status` notifications; the signed-in
    account arrives as `linkedin.login.complete`.
    """

    def on_event(kind: str, payload: dict[str, Any]) -> None:
        ctx.notify(f"linkedin.login.{kind}", payload)

    return await auth.login(on_event)


@method("linkedin.cancelLogin")
def linkedin_cancel_login() -> dict[str, Any]:
    """Stop waiting for an in-flight sign-in."""
    auth.cancel()
    return {"cancelled": True}


@method("linkedin.logout")
async def linkedin_logout() -> dict[str, Any]:
    """Sign out and delete the stored session and browser profile."""
    return await auth.logout()


@method("linkedin.account")
def linkedin_account() -> dict[str, Any] | None:
    """The connected account, without its session."""
    return accounts.get_active()


@method("linkedin.analyzeSearch")
async def linkedin_analyze_search(ctx: RpcContext, url: str) -> dict[str, Any]:
    """Read a LinkedIn search and return a campaign plan.

    Emits `engine.progress` as it works so the create-campaign modal can show
    what is actually happening rather than a generic spinner.
    """

    def on_progress(step: dict[str, Any]) -> None:
        ctx.progress(step["label"], percent=step["progress"] * 100, step=step)

    return await search.analyze(url, on_progress)


@method("linkedin.importProspects")
async def linkedin_import_prospects(
    campaign_id: str, search_url: str, pages: int = 4
) -> dict[str, Any]:
    """Queue the people a search returns against a campaign."""
    queued = await search.import_prospects(campaign_id, search_url, pages)
    return {"queued": queued}
