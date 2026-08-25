"""Reading a LinkedIn search and turning it into a campaign plan.

The numbers come from the page — the app opens the search as the signed-in user
and reads the real result count and the real first page of people. Claude is then
asked to turn those facts, plus the user's own limits, into a plan: what to call
the campaign, how fast to run it, and what the operator should know before
approving it.

The split matters. Counting is something a browser does reliably and a model does
not, so the model is never asked to guess a number it could get wrong; it is asked
to reason about numbers already established.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
from datetime import date
from typing import Any

from ...core.logging import get_logger
from ...rpc.protocol import ErrorCode, InvalidParams, RpcException
from ...store import campaigns as campaign_store
from ...store import settings_store
from ..ai import reason
from ..browser import actions
from ..browser.agent import BrowserAgent
from ..browser.runtime import runtime

log = get_logger(__name__)

SALES_NAVIGATOR = re.compile(r"^https?://(www\.)?linkedin\.com/sales/search/", re.IGNORECASE)
PEOPLE_SEARCH = re.compile(r"^https?://(www\.)?linkedin\.com/search/results/people", re.IGNORECASE)

#: "About 2,431 results", "2,431 results", "Showing 1-25 of 2,431"
_COUNT_PATTERNS = (
    re.compile(r"of\s+([\d,\.]+)\s+result", re.IGNORECASE),
    re.compile(r"about\s+([\d,\.]+)\s+result", re.IGNORECASE),
    re.compile(r"([\d,\.]+)\s+result", re.IGNORECASE),
    re.compile(r"([\d,\.]+)\s+people", re.IGNORECASE),
)

#: LinkedIn stops paginating a search at 2,500 results however many it claims to
#: have matched, so a campaign can never actually reach more than this.
REACHABLE_CEILING = 2_500

PLANNER_SYSTEM = """You plan LinkedIn outreach campaigns for a desktop tool.

You are given verified facts about a search — the counts were read off the page, \
not estimated — and the operator's own automation limits. Produce a plan that \
respects those limits exactly. Never propose a daily volume above the stated \
ceiling; LinkedIn restricts accounts that exceed it.

Reply with a single JSON object:
{
  "suggestedName": "short campaign name from the audience, max 6 words",
  "dailyConnections": <integer, at or below the ceiling>,
  "recommendations": ["4-5 short factual statements about this campaign"],
  "rationale": "one sentence on how the pace was chosen"
}"""


def classify_url(url: str) -> str:
    """Which kind of search this is, or raise if it is not one."""
    value = url.strip()
    if SALES_NAVIGATOR.match(value):
        return "sales-navigator"
    if PEOPLE_SEARCH.match(value):
        return "search"
    raise InvalidParams(
        "That is not a LinkedIn search URL. Paste a Sales Navigator search "
        "(linkedin.com/sales/search/…) or a people search (linkedin.com/search/results/people…)."
    )


async def _read_result_count(page: Any) -> int | None:
    """Read the total the page reports, without asking a model."""
    try:
        text = await page.evaluate(
            "() => (document.querySelector('main') || document.body).innerText.slice(0, 4000)"
        )
    except Exception as error:
        log.warning("Could not read the search page text: %s", error)
        return None

    for pattern in _COUNT_PATTERNS:
        match = pattern.search(text or "")
        if match:
            digits = match.group(1).replace(",", "").replace(".", "")
            if digits.isdigit():
                return int(digits)
    return None


async def _collect_prospects(page: Any, limit: int = 25) -> list[dict[str, Any]]:
    """Pull the people visible on the current results page."""
    try:
        rows = await page.evaluate(
            """
            (limit) => {
              const seen = new Set()
              const out = []
              const links = document.querySelectorAll('a[href*="/in/"], a[href*="/sales/lead/"]')

              for (const link of links) {
                if (out.length >= limit) break
                const href = link.href.split('?')[0]
                if (seen.has(href)) continue

                const name = (link.innerText || '').trim().split('\\n')[0]
                if (!name || name.length > 80) continue
                seen.add(href)

                // The row is the nearest list item; the lines under the name are
                // the headline and location in LinkedIn's own order.
                const row = link.closest('li, .artdeco-list__item, [data-chameleon-result-urn]')
                const lines = row
                  ? (row.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean)
                  : []
                const after = lines.indexOf(name)

                out.push({
                  fullName: name,
                  profileUrl: href,
                  headline: after >= 0 ? lines[after + 1] || null : null,
                  location: after >= 0 ? lines[after + 2] || null : null
                })
              }
              return out
            }
            """,
            limit,
        )
    except Exception as error:
        log.warning("Could not read prospects from the search page: %s", error)
        return []

    return [row for row in rows if row.get("profileUrl")]


async def analyze(url: str, on_progress: Any = None) -> dict[str, Any]:
    """Open a search, count it, sample it, and have Claude plan the campaign."""
    source = classify_url(url)

    def progress(message: str, fraction: float) -> None:
        if on_progress:
            on_progress({"label": message, "progress": fraction})

    progress("Opening the search as your account…", 0.12)
    page = await runtime.page(headless=True)

    try:
        await page.goto(url.strip(), wait_until="domcontentloaded", timeout=45_000)
    except Exception as error:
        raise RpcException(
            f"Could not open that search: {str(error).splitlines()[0][:200]}",
            ErrorCode.ENGINE_ERROR,
        ) from error

    await actions.settle(page)

    if "/login" in page.url or "/authwall" in page.url or "/checkpoint/" in page.url:
        raise RpcException(
            "LinkedIn asked for a sign-in. Reconnect your account in Settings and try again.",
            ErrorCode.ENGINE_ERROR,
            {"reason": "session-expired"},
        )

    progress("Counting matching prospects…", 0.34)
    total = await _read_result_count(page)

    if total is None:
        # The layout moved. This is exactly the case the agent exists for: let
        # Claude find the count on a page whose shape we no longer recognise.
        progress("Reading the page layout…", 0.44)
        agent = BrowserAgent(page, max_steps=4)
        result = await agent.run(
            "Find the total number of search results shown on this page and return "
            "just that number.",
            context="The count usually appears above the result list.",
        )
        if result.ok and result.data:
            digits = re.sub(r"[^\d]", "", str(result.data))
            total = int(digits) if digits else None

    if total is None:
        raise RpcException(
            "Could not read how many results this search returns. Open it in LinkedIn "
            "and check it loads normally.",
            ErrorCode.ENGINE_ERROR,
        )

    progress("Sampling the first page of results…", 0.58)
    sample = await _collect_prospects(page)

    reachable = min(total, REACHABLE_CEILING)

    progress("Applying your daily limits…", 0.74)
    settings = settings_store.get_automation()
    ceiling = settings_store.daily_limit_for(settings)
    days_per_week = settings_store.working_days_per_week(settings)

    progress("Preparing the campaign plan…", 0.88)
    plan = await _plan(url, source, total, reachable, sample, ceiling, days_per_week)

    daily = max(1, min(ceiling, int(plan.get("dailyConnections") or ceiling)))
    duration_days = math.ceil(reachable / daily)
    completion = campaign_store.working_day_end(date.today(), duration_days, days_per_week)

    progress("Campaign plan ready", 1.0)

    return {
        "source": source,
        "searchUrl": url.strip(),
        "suggestedName": plan.get("suggestedName") or _name_from_url(url),
        "targetProspects": reachable,
        "totalMatches": total,
        "estimatedDurationDays": duration_days,
        "dailyConnections": daily,
        "expectedCompletion": completion,
        "recommendations": _recommendations(plan, total, reachable, daily, duration_days),
        "sampleProspects": sample[:10],
        "rationale": {
            "prospects": reachable,
            "dailyLimit": daily,
            "completionDate": completion,
            "explanation": plan.get("rationale")
            or f"{daily} invitations a day is the ceiling set in your automation settings.",
        },
    }


async def _plan(
    url: str,
    source: str,
    total: int,
    reachable: int,
    sample: list[dict[str, Any]],
    ceiling: int,
    days_per_week: int,
) -> dict[str, Any]:
    """Ask Claude to name and pace the campaign from verified facts."""
    audience = "\n".join(
        f"- {person['fullName']}"
        + (f" — {person['headline']}" if person.get("headline") else "")
        + (f" ({person['location']})" if person.get("location") else "")
        for person in sample[:8]
    )

    filters = _filters_from_url(url)
    prompt = f"""Search URL: {url}
Search type: {"Sales Navigator" if source == "sales-navigator" else "LinkedIn people search"}
Filters detected in the URL: {json.dumps(filters) if filters else "none readable"}

Verified counts (read from the page, do not change them):
- Total matches reported by LinkedIn: {total:,}
- Reachable in a campaign: {reachable:,} (LinkedIn stops paginating past {REACHABLE_CEILING:,})

Operator's automation settings:
- Maximum connection requests per day: {ceiling}
- Days the automation runs per week: {days_per_week}

Sample of the audience:
{audience or "(no sample could be read)"}

Plan this campaign."""

    try:
        return await reason.ask_json(
            prompt,
            system=PLANNER_SYSTEM,
            tier=reason.REASONING,
            purpose="campaign.plan",
            max_tokens=600,
        )
    except RpcException as error:
        # A campaign can still be created without the model's naming and framing;
        # refusing to plan at all because the AI was unreachable would be worse.
        log.warning("Campaign planning fell back to defaults: %s", error.message)
        return {}


def _recommendations(
    plan: dict[str, Any], total: int, reachable: int, daily: int, duration: int
) -> list[str]:
    """Model commentary, with the facts guaranteed to be present either way."""
    facts = [f"{reachable:,} prospects reachable in this campaign"]
    if total > reachable:
        facts.append(
            f"LinkedIn matched {total:,}, but only the first {reachable:,} can be paged through"
        )
    facts.append(f"{daily} invitations a day, within your configured limit")
    facts.append(f"Estimated {duration} working days to complete")

    extra = [
        str(item)
        for item in (plan.get("recommendations") or [])
        if isinstance(item, str) and item.strip()
    ]
    # The model's points come after the verified ones, and never replace them.
    return facts + extra[:3]


def _filters_from_url(url: str) -> dict[str, Any]:
    """Whatever the search URL says about who is being targeted."""
    from urllib.parse import parse_qs, urlparse

    try:
        query = parse_qs(urlparse(url).query)
    except ValueError:
        return {}

    interesting = ("keywords", "query", "titleFreeText", "companySize", "geoUrn", "industry")
    return {
        key: value[0][:200]
        for key, value in query.items()
        if key in interesting and value and value[0]
    }


def _name_from_url(url: str) -> str:
    """A readable fallback name when the model could not be reached."""
    filters = _filters_from_url(url)
    keywords = filters.get("keywords") or filters.get("query") or filters.get("titleFreeText")
    if keywords:
        cleaned = re.sub(r"[^\w\s-]", " ", keywords).strip()
        if cleaned:
            return " ".join(word.capitalize() for word in cleaned.split()[:5])
    return f"LinkedIn Campaign {date.today().isoformat()}"


async def import_prospects(campaign_id: str, search_url: str, pages: int = 4) -> int:
    """Walk the search and queue everyone it returns.

    Paging is deliberately slow and bounded — this is a real account making real
    requests, and hammering the search endpoint is the fastest way to get one
    restricted.
    """
    page = await runtime.page(headless=True)
    await page.goto(search_url, wait_until="domcontentloaded", timeout=45_000)
    await actions.settle(page)

    queued = 0
    for index in range(max(1, pages)):
        prospects = await _collect_prospects(page, limit=100)
        queued += campaign_store.add_prospects(campaign_id, prospects)

        if index == pages - 1:
            break

        next_button = page.get_by_role("button", name=re.compile("next", re.IGNORECASE))
        if not await next_button.count() or not await next_button.first.is_enabled():
            break

        await next_button.first.click()
        await actions.settle(page)
        # A human reading a page of results, not a scraper.
        await asyncio.sleep(2.5)

    campaign_store.recount_sent(campaign_id)
    campaign_store.log_activity(
        "import", f"Queued {queued} prospects from the search", campaign_id=campaign_id
    )
    return queued
