"""Turning a decision into something that happens on the page.

Two ways to reach an element, and the difference matters:

* **By ref** — ``[data-oa-ref="e12"]``, tagged by the snapshot that the model was
  looking at. Exact, unambiguous, and only valid until the page changes.
* **By role and name** — how a person would describe it ("the button that says
  Connect"). Survives a reload, which is what lets a cached plan be replayed on a
  later visit without asking the model again.

Every action returns a result rather than raising on a miss, because "the button
wasn't there" is information the agent needs in order to try something else, not
an error that should end the run.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from ...core.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover
    from playwright.async_api import Locator, Page

log = get_logger(__name__)

#: How long to wait for an element the model just asked for. Short: if it is not
#: there almost immediately, the page is not in the state we thought it was, and
#: re-perceiving beats waiting.
ELEMENT_TIMEOUT_MS = 5_000

#: Actions the model is allowed to ask for. Anything else is rejected before it
#: touches the page — the model proposes, this list disposes.
ACTIONS = (
    "click",
    "fill",
    "press",
    "select",
    "scroll",
    "navigate",
    "wait",
    "extract",
    "done",
    "fail",
)


@dataclass(slots=True)
class ActionResult:
    ok: bool
    action: str
    detail: str = ""
    data: Any = None
    #: Set when the page navigated as a result, so the caller knows the snapshot
    #: it is holding is stale.
    navigated: bool = False


class ActionError(Exception):
    """A malformed action — the model asked for something that is not offered."""


def _validate(action: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    kind = str(action.get("action") or "").strip().lower()
    if kind not in ACTIONS:
        raise ActionError(f"Unknown action {kind!r}; expected one of {', '.join(ACTIONS)}")
    return kind, action


async def resolve(page: Page, target: dict[str, Any]) -> Locator | None:
    """Find the element an action refers to, by ref or by role and name."""
    ref = target.get("ref")
    if ref:
        locator = page.locator(f'[data-oa-ref="{ref}"]')
        if await locator.count():
            return locator.first

    role = target.get("role")
    name = target.get("name")
    if role:
        # `exact=False` because accessible names pick up whitespace and suffixes
        # between renders; the role already narrows it enough to stay safe.
        locator = page.get_by_role(role, name=name, exact=False) if name else page.get_by_role(role)
        if await locator.count():
            return locator.first

    if name:
        locator = page.get_by_text(name, exact=False)
        if await locator.count():
            return locator.first

    return None


async def execute(page: Page, action: dict[str, Any]) -> ActionResult:
    """Carry out one validated action against the page."""
    kind, payload = _validate(action)
    url_before = page.url

    if kind in ("done", "fail"):
        return ActionResult(
            ok=kind == "done",
            action=kind,
            detail=str(payload.get("reason") or payload.get("summary") or ""),
            data=payload.get("result"),
        )

    if kind == "navigate":
        url = str(payload.get("url") or "").strip()
        if not url.startswith("http"):
            return ActionResult(False, kind, f"Refusing to navigate to {url!r}")
        await page.goto(url, wait_until="domcontentloaded")
        await settle(page)
        return ActionResult(True, kind, f"Navigated to {url}", navigated=True)

    if kind == "wait":
        seconds = min(10.0, float(payload.get("seconds") or 1.0))
        await asyncio.sleep(seconds)
        return ActionResult(True, kind, f"Waited {seconds:g}s")

    if kind == "scroll":
        direction = str(payload.get("direction") or "down").lower()
        amount = int(payload.get("amount") or 600)
        delta = amount if direction == "down" else -amount
        await page.mouse.wheel(0, delta)
        await asyncio.sleep(0.4)
        return ActionResult(True, kind, f"Scrolled {direction} {abs(delta)}px")

    # Everything below acts on a specific element.
    locator = await resolve(page, payload)
    if locator is None:
        return ActionResult(
            False, kind, f"Could not find {payload.get('ref') or payload.get('name') or 'the element'}"
        )

    try:
        if kind == "click":
            await locator.scroll_into_view_if_needed(timeout=ELEMENT_TIMEOUT_MS)
            await locator.click(timeout=ELEMENT_TIMEOUT_MS)
            await settle(page)

        elif kind == "fill":
            value = str(payload.get("value") or "")
            await locator.fill(value, timeout=ELEMENT_TIMEOUT_MS)

        elif kind == "press":
            key = str(payload.get("key") or "Enter")
            await locator.press(key, timeout=ELEMENT_TIMEOUT_MS)
            await settle(page)

        elif kind == "select":
            value = str(payload.get("value") or "")
            await locator.select_option(label=value, timeout=ELEMENT_TIMEOUT_MS)

        elif kind == "extract":
            text = await locator.inner_text(timeout=ELEMENT_TIMEOUT_MS)
            return ActionResult(True, kind, "Extracted text", data=text.strip())

    except Exception as error:
        message = str(error).splitlines()[0][:200]
        log.debug("Action %s failed: %s", kind, message)
        return ActionResult(False, kind, message)

    return ActionResult(
        True,
        kind,
        payload.get("description") or f"{kind} on {payload.get('name') or payload.get('ref')}",
        navigated=page.url != url_before,
    )


async def settle(page: Page, timeout_ms: int = 8_000) -> None:
    """Wait for the page to stop moving, without waiting for it to go quiet.

    ``networkidle`` never fires on LinkedIn — there is always a poll in flight —
    so this waits for the DOM instead and gives late-rendering content a beat.
    """
    # A page that never settles is still worth acting on — the snapshot taken
    # next will say what is actually there.
    with contextlib.suppress(Exception):
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    await asyncio.sleep(0.6)
