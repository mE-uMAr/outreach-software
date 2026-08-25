"""Signing in to LinkedIn.

The user signs in **in a real browser window, themselves**. The app opens
LinkedIn's own login page and watches for the session cookie to appear; it never
sees, handles or stores a password, and two-factor prompts, e-mail challenges and
security checkpoints all work exactly as they normally would because the user is
the one answering them.

Once the session exists it is captured, encrypted and stored so the next run
resumes instead of asking again.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import TYPE_CHECKING, Any

from ...core.logging import get_logger
from ...rpc.protocol import ErrorCode, RpcException
from ...store import accounts
from ..browser.runtime import runtime

if TYPE_CHECKING:  # pragma: no cover
    from playwright.async_api import BrowserContext, Page

log = get_logger(__name__)

LOGIN_URL = "https://www.linkedin.com/login"
FEED_URL = "https://www.linkedin.com/feed/"
SALES_URL = "https://www.linkedin.com/sales/index"

#: The cookie that *is* the session. Its presence means signed in; its absence
#: means signed out, whatever the page happens to be showing.
SESSION_COOKIE = "li_at"

#: How long the window stays open waiting for the user to finish. Generous —
#: they may have to fetch a code from their phone or clear a checkpoint.
LOGIN_TIMEOUT_SECONDS = 600
POLL_INTERVAL_SECONDS = 1.5

#: Pages that mean LinkedIn wants something from the user before letting them in.
_CHALLENGE_PATTERN = re.compile(
    r"/checkpoint/|/challenge|/uas/login-submit|captcha", re.IGNORECASE
)

_login_lock = asyncio.Lock()
_cancelled = False


async def _session_cookie(context: BrowserContext) -> str | None:
    for cookie in await context.cookies("https://www.linkedin.com"):
        if cookie.get("name") == SESSION_COOKIE and cookie.get("value"):
            return str(cookie["value"])
    return None


async def _csrf_token(context: BrowserContext) -> str | None:
    """LinkedIn's own API wants the JSESSIONID value echoed back as a header."""
    for cookie in await context.cookies("https://www.linkedin.com"):
        if cookie.get("name") == "JSESSIONID":
            return str(cookie["value"]).strip('"')
    return None


async def fetch_profile(page: Page, context: BrowserContext) -> dict[str, Any]:
    """Read the signed-in user's own profile.

    Uses the same endpoint the LinkedIn web app calls for its own header, run
    from inside the page so the session cookies apply. That is both far cheaper
    than scraping and far more stable than depending on class names — with a DOM
    read kept as the fallback for when it is not.
    """
    token = await _csrf_token(context)
    profile: dict[str, Any] = {}

    if token:
        try:
            payload = await page.evaluate(
                """
                async (token) => {
                  const response = await fetch('/voyager/api/me', {
                    headers: { 'csrf-token': token, accept: 'application/json' },
                    credentials: 'include'
                  })
                  if (!response.ok) return null
                  return response.json()
                }
                """,
                token,
            )
        except Exception as error:
            log.warning("Could not read the LinkedIn profile API: %s", error)
            payload = None

        if payload:
            mini = payload.get("miniProfile") or {}
            public_id = mini.get("publicIdentifier")
            profile = {
                "memberUrn": mini.get("entityUrn") or payload.get("entityUrn"),
                "publicId": public_id,
                "fullName": " ".join(
                    part for part in (mini.get("firstName"), mini.get("lastName")) if part
                ).strip(),
                "headline": mini.get("occupation") or "",
                "profileUrl": f"https://www.linkedin.com/in/{public_id}/" if public_id else None,
                "avatarUrl": _picture_url(mini),
                "premium": bool(payload.get("premiumSubscriber")),
            }

    if not profile.get("fullName"):
        profile = await _scrape_profile(page) | profile

    profile["salesNavigator"] = await _has_sales_navigator(page)
    return profile


def _picture_url(mini: dict[str, Any]) -> str | None:
    """Rebuild an avatar URL from LinkedIn's split root/segment representation."""
    picture = (mini.get("picture") or {}).get("com.linkedin.common.VectorImage")
    if not picture:
        return None
    artifacts = picture.get("artifacts") or []
    if not artifacts:
        return None
    # The largest artifact last; a display picture is small either way.
    return f"{picture.get('rootUrl', '')}{artifacts[-1].get('fileIdentifyingUrlPathSegment', '')}"


async def _scrape_profile(page: Page) -> dict[str, Any]:
    """Fallback: read the name off the page itself."""
    try:
        await page.goto("https://www.linkedin.com/in/me/", wait_until="domcontentloaded")
        await asyncio.sleep(1.5)
        public_id = None
        match = re.search(r"/in/([^/?]+)", page.url)
        if match:
            public_id = match.group(1)

        name = ""
        for selector in ("h1", "[data-generated-suggestion-target] h1", ".text-heading-xlarge"):
            locator = page.locator(selector).first
            if await locator.count():
                name = (await locator.inner_text()).strip()
                if name:
                    break

        headline = ""
        headline_locator = page.locator(".text-body-medium").first
        if await headline_locator.count():
            headline = (await headline_locator.inner_text()).strip()

        return {
            "publicId": public_id,
            "memberUrn": f"urn:li:publicId:{public_id}" if public_id else None,
            "fullName": name,
            "headline": headline,
            "profileUrl": f"https://www.linkedin.com/in/{public_id}/" if public_id else None,
        }
    except Exception as error:
        log.warning("Could not read the LinkedIn profile page: %s", error)
        return {}


async def _has_sales_navigator(page: Page) -> bool:
    """Whether this account can reach Sales Navigator.

    It decides which campaign sources the UI can offer, so it is worth the one
    extra navigation at sign-in rather than failing later inside a campaign.
    """
    try:
        await page.goto(SALES_URL, wait_until="domcontentloaded", timeout=20_000)
        await asyncio.sleep(1.0)
        # An account without a seat is bounced to a marketing or upsell page.
        return "/sales/" in page.url and "signup" not in page.url and "upsell" not in page.url
    except Exception:
        return False


async def status(deep: bool = False) -> dict[str, Any]:
    """Whether the app has a usable LinkedIn session.

    The shallow check reads the database and is what the UI polls. The deep check
    opens the browser and asks LinkedIn, which is the only way to notice a session
    that has been invalidated server-side.
    """
    account = accounts.get_active()
    base = {
        "connected": bool(account and account["status"] == "connected"),
        "account": account,
        "checkedAt": time.time(),
    }

    if not deep or account is None:
        return base

    try:
        context = await runtime.context(headless=True)
        cookie = await _session_cookie(context)
    except RpcException as error:
        # The browser runtime is missing; that is not the same as being signed
        # out, and reporting it as such would send the user round a pointless loop.
        return base | {"verified": False, "verifyError": error.message}

    if cookie is None:
        accounts.mark_expired("no session cookie in the browser profile")
        return {"connected": False, "account": accounts.get_active(), "checkedAt": time.time()}

    return base | {"verified": True}


def cancel() -> None:
    """Ask an in-flight sign-in to stop waiting."""
    global _cancelled
    _cancelled = True


async def login(on_event: Any = None) -> dict[str, Any]:
    """Open LinkedIn's login page and wait for the user to finish signing in."""
    global _cancelled

    if _login_lock.locked():
        raise RpcException("A LinkedIn sign-in is already in progress", ErrorCode.ENGINE_ERROR)

    async with _login_lock:
        _cancelled = False

        def emit(kind: str, **payload: Any) -> None:
            if on_event:
                on_event(kind, payload)

        emit("status", message="Opening a browser window…")
        # Always windowed: the user has to be able to type into it.
        context = await runtime.context(headless=False)
        page = await runtime.page(headless=False)

        await page.goto(LOGIN_URL, wait_until="domcontentloaded")
        await page.bring_to_front()
        emit(
            "status",
            message="Sign in to LinkedIn in the browser window that just opened.",
            url=LOGIN_URL,
        )

        deadline = time.monotonic() + LOGIN_TIMEOUT_SECONDS
        announced_challenge = False

        while time.monotonic() < deadline:
            if _cancelled:
                emit("status", message="Sign-in cancelled.")
                raise RpcException("Sign-in was cancelled", ErrorCode.ENGINE_ERROR)

            if page.is_closed():
                raise RpcException(
                    "The sign-in window was closed before sign-in finished.",
                    ErrorCode.ENGINE_ERROR,
                )

            cookie = await _session_cookie(context)
            if cookie:
                break

            current = page.url
            if _CHALLENGE_PATTERN.search(current) and not announced_challenge:
                announced_challenge = True
                emit(
                    "status",
                    message="LinkedIn asked for a verification step — complete it in the window.",
                )

            runtime.touch()
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
        else:
            raise RpcException(
                "Timed out waiting for the LinkedIn sign-in to complete.", ErrorCode.TIMEOUT
            )

        emit("status", message="Signed in. Reading your account details…")

        # Land on the feed first: some account details are only populated once
        # the app shell has loaded at least once.
        try:
            await page.goto(FEED_URL, wait_until="domcontentloaded")
            await asyncio.sleep(1.5)
        except Exception as error:
            log.warning("Could not open the feed after sign-in: %s", error)

        profile = await fetch_profile(page, context)
        if not profile.get("memberUrn") and not profile.get("publicId"):
            raise RpcException(
                "Signed in, but LinkedIn did not return an account to identify. Try again.",
                ErrorCode.ENGINE_ERROR,
            )

        storage_state = await runtime.storage_state()
        account = accounts.save(profile, storage_state)

        emit("complete", account=account)
        log.info("Connected LinkedIn account %s", account.get("fullName"))
        return {"connected": True, "account": account}


async def logout() -> dict[str, Any]:
    """Sign out: clear the session on LinkedIn's side, then forget it here."""
    try:
        if runtime.is_open:
            page = await runtime.page(headless=True)
            await page.goto("https://www.linkedin.com/m/logout/", wait_until="domcontentloaded")
            await asyncio.sleep(1.0)
    except Exception as error:
        # Best effort — the local session is cleared either way, which is what
        # actually stops this app from acting as the user.
        log.warning("Could not sign out on LinkedIn's side: %s", error)

    await runtime.close()
    runtime.reset_profile()
    accounts.disconnect()
    return {"connected": False, "account": None}
