"""Playwright lifecycle.

One browser, kept warm. Launching Chromium costs about two seconds and restoring
a LinkedIn session costs another two, so the automation opens the browser once
and reuses it across calls rather than paying that on every step.

Two decisions worth stating:

* **A persistent profile, not a fresh context.** LinkedIn scores the device it is
  talking to. A throwaway context looks like a brand-new machine on every run,
  which is exactly the signal that triggers a checkpoint. The profile directory
  lives beside the database and keeps local storage, service workers and the
  device identity stable across restarts.
* **Playwright is imported lazily.** The engine has to boot, answer
  ``system.info`` and let the UI render even on a machine where the browser
  runtime was never installed — so the import happens on first use and a missing
  package becomes a readable message rather than a dead sidecar.
"""

from __future__ import annotations

import asyncio
import shutil
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ...core.config import get_settings
from ...core.logging import get_logger
from ...rpc.protocol import ErrorCode, RpcException

if TYPE_CHECKING:  # pragma: no cover - import-time only for type checkers
    from playwright.async_api import BrowserContext, Page, Playwright

log = get_logger(__name__)

PROFILE_DIRNAME = "browser-profile"

#: Close the browser after this long with nothing to do. Long enough that a user
#: reading a campaign plan does not pay a cold start when they hit Launch.
IDLE_SHUTDOWN_SECONDS = 300

#: A desktop viewport LinkedIn serves its full layout to. Smaller and it switches
#: to a condensed DOM whose selectors differ from every cached plan.
VIEWPORT = {"width": 1440, "height": 900}

#: Chromium flags. `--disable-blink-features=AutomationControlled` removes the
#: `navigator.webdriver` banner that marks an automated browser; the rest are
#: about running reliably inside a packaged desktop app.
LAUNCH_ARGS = (
    "--disable-blink-features=AutomationControlled",
    "--no-default-browser-check",
    "--no-first-run",
    "--disable-features=Translate,OptimizationHints",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
)


class BrowserUnavailable(RpcException):
    """Raised when Playwright or its Chromium build is not installed."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message, ErrorCode.UNAVAILABLE, {"reason": reason})


def profile_dir() -> Path:
    path = get_settings().data_dir / PROFILE_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def _import_playwright() -> Any:
    try:
        from playwright.async_api import async_playwright
    except ImportError as error:
        raise BrowserUnavailable(
            "The browser runtime is not installed yet. Install it from Settings to "
            "let the app drive LinkedIn.",
            "playwright-missing",
        ) from error
    return async_playwright


def runtime_status() -> dict[str, Any]:
    """Whether the browser can run, without launching anything."""
    try:
        import playwright  # noqa: F401
    except ImportError:
        return {
            "installed": False,
            "reason": "playwright-missing",
            "message": "The Playwright package is not installed.",
            "profileDir": str(profile_dir()),
        }

    from playwright._impl._driver import compute_driver_executable  # type: ignore

    try:
        driver = Path(compute_driver_executable()[0])
        driver_ok = driver.exists()
    except Exception:  # pragma: no cover - defensive against internal API drift
        driver_ok = False

    chromium = _chromium_build()
    shipped = bundled_root()
    return {
        "installed": bool(chromium) and driver_ok,
        "reason": None if chromium else "chromium-missing",
        "message": None
        if chromium
        else "Chromium has not been downloaded yet. Install it from Settings.",
        "chromiumPath": str(chromium) if chromium else None,
        # True when the browser came with the installer, so the UI can say
        # "included" rather than offering a download nobody needs.
        "bundled": bool(chromium and shipped and str(chromium).startswith(str(shipped))),
        "profileDir": str(profile_dir()),
    }


def bundled_root() -> Path | None:
    """Where Chromium lives when it shipped inside the installer.

    The frozen engine sits at ``resources/engine/``, so its sibling
    ``resources/chromium/`` is what electron-builder copied in. Checked first and
    without any network, which is the whole point: a user who installs the app
    has a working browser immediately rather than a 150 MB download standing
    between them and their first campaign.
    """
    candidates = []
    if getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable).resolve().parent.parent / "chromium")
    # Development: `npm run dev` runs from source, next to the build output.
    candidates.append(Path(__file__).resolve().parents[3] / "dist" / "chromium")

    return next((path for path in candidates if path.is_dir()), None)


def _chromium_build() -> Path | None:
    """Find Chromium: bundled first, then Playwright's own cache."""
    import os

    roots: list[Path] = []

    # Shipped with the app beats anything the user may have downloaded, so the
    # version tested against the app is the version that runs.
    shipped = bundled_root()
    if shipped:
        roots.append(shipped)

    override = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if override and override != "0":
        roots.append(Path(override))

    home = Path.home()
    if sys.platform == "win32":
        roots.append(Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local")) / "ms-playwright")
    elif sys.platform == "darwin":
        roots.append(home / "Library" / "Caches" / "ms-playwright")
    else:
        roots.append(home / ".cache" / "ms-playwright")

    executable = "chrome.exe" if sys.platform == "win32" else "chrome"
    relatives = (
        Path("chrome-win") / executable,
        Path("chrome-linux") / executable,
        Path("chrome-mac") / "Chromium.app" / "Contents" / "MacOS" / "Chromium",
    )

    for root in roots:
        if not root.exists():
            continue
        # A bundled root may hold the chromium-XXXX folder directly, or be that
        # folder itself, depending on how the build copied it.
        for candidate in [root, *sorted(root.glob("chromium*"), reverse=True)]:
            for relative in relatives:
                if (candidate / relative).exists():
                    return candidate / relative
    return None


async def install_runtime(on_output: Any = None) -> dict[str, Any]:
    """Download Chromium via Playwright's own installer.

    Streams the installer's output so the UI can show real progress rather than
    an indeterminate spinner over a 150 MB download.
    """
    try:
        import playwright  # noqa: F401
    except ImportError as error:
        raise BrowserUnavailable(
            "The Playwright package is missing from this build, so Chromium cannot "
            "be installed. Reinstall the app.",
            "playwright-missing",
        ) from error

    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "playwright",
        "install",
        "chromium",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert process.stdout is not None

    async for raw in process.stdout:
        line = raw.decode("utf-8", "replace").strip()
        if line:
            log.info("playwright install: %s", line)
            if on_output:
                on_output(line)

    code = await process.wait()
    if code != 0:
        raise RpcException(
            f"Installing the browser runtime failed (exit {code}). Check the connection and retry.",
            ErrorCode.ENGINE_ERROR,
        )
    return runtime_status()


class BrowserRuntime:
    """Owns the single browser context the whole app shares."""

    def __init__(self) -> None:
        self._playwright: Playwright | None = None
        self._context: BrowserContext | None = None
        self._lock = asyncio.Lock()
        self._last_used = 0.0
        self._reaper: asyncio.Task[None] | None = None

    @property
    def is_open(self) -> bool:
        return self._context is not None

    async def context(self, headless: bool | None = None) -> BrowserContext:
        """The shared context, launching it if this is the first call."""
        async with self._lock:
            if self._context is not None:
                self._last_used = time.monotonic()
                return self._context

            chromium = _chromium_build()
            if chromium is None:
                raise BrowserUnavailable(
                    "Chromium has not been downloaded yet. Install the browser runtime "
                    "from Settings.",
                    "chromium-missing",
                )

            async_playwright = _import_playwright()
            self._playwright = await async_playwright().start()

            resolved_headless = bool(headless)
            log.info(
                "Launching Chromium (%s) with profile %s",
                "headless" if resolved_headless else "windowed",
                profile_dir(),
            )

            self._context = await self._playwright.chromium.launch_persistent_context(
                str(profile_dir()),
                # Explicit, so the browser that ships with the app is the one
                # that runs even when Playwright has its own copy cached.
                executable_path=str(chromium),
                headless=resolved_headless,
                viewport=VIEWPORT,
                args=list(LAUNCH_ARGS),
                locale="en-US",
                timezone_id="UTC",
                # Chromium's default UA advertises HeadlessChrome even when
                # windowed under some builds; pinning it keeps the two modes
                # indistinguishable to the site.
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
                ),
                ignore_default_args=["--enable-automation"],
            )
            self._context.set_default_timeout(20_000)
            self._context.set_default_navigation_timeout(45_000)

            self._last_used = time.monotonic()
            self._start_reaper()
            return self._context

    async def page(self, headless: bool | None = None) -> Page:
        """The working tab, reusing the one the persistent profile opens with."""
        context = await self.context(headless)
        self._last_used = time.monotonic()

        for existing in context.pages:
            if not existing.is_closed():
                return existing
        return await context.new_page()

    def touch(self) -> None:
        """Mark the browser as in use so the idle reaper leaves it alone."""
        self._last_used = time.monotonic()

    async def storage_state(self) -> dict[str, Any] | None:
        """Snapshot cookies and origins for encrypted storage."""
        if self._context is None:
            return None
        try:
            return await self._context.storage_state()
        except Exception as error:  # pragma: no cover - context can race a close
            log.warning("Could not read browser storage state: %s", error)
            return None

    async def close(self) -> None:
        async with self._lock:
            await self._close_locked()

    async def _close_locked(self) -> None:
        if self._reaper is not None:
            self._reaper.cancel()
            self._reaper = None

        if self._context is not None:
            try:
                await self._context.close()
            except Exception as error:  # pragma: no cover
                log.warning("Error closing browser context: %s", error)
            self._context = None

        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception as error:  # pragma: no cover
                log.warning("Error stopping Playwright: %s", error)
            self._playwright = None
        log.info("Browser closed")

    def _start_reaper(self) -> None:
        if self._reaper is not None:
            return

        async def reap() -> None:
            while True:
                await asyncio.sleep(30)
                if self._context is None:
                    return
                if time.monotonic() - self._last_used < IDLE_SHUTDOWN_SECONDS:
                    continue
                log.info("Browser idle for %ds; closing it", IDLE_SHUTDOWN_SECONDS)
                async with self._lock:
                    await self._close_locked()
                return

        self._reaper = asyncio.create_task(reap(), name="browser-idle-reaper")

    def reset_profile(self) -> bool:
        """Delete the browser profile. The browser must already be closed."""
        path = get_settings().data_dir / PROFILE_DIRNAME
        if not path.exists():
            return False
        shutil.rmtree(path, ignore_errors=True)
        log.info("Cleared browser profile at %s", path)
        return True


#: Process-wide runtime. Everything that drives a page goes through this.
runtime = BrowserRuntime()
