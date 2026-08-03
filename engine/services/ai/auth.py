"""Claude sign-in pipeline.

Wraps `claude auth {status,login,logout}`, always against the app's sandboxed
session directory. Login is interactive: the CLI prints a URL, the user
authorises in a browser, and the CLI exits once the callback lands. The URL is
surfaced to the UI as it appears so the app can open it.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Callable
from typing import Any

from ...core.logging import get_logger
from ...rpc.protocol import ErrorCode, RpcException
from .session import cli_env, find_cli, session_dir

log = get_logger(__name__)

#: Login waits on a human; give them a few minutes.
LOGIN_TIMEOUT_SECONDS = 300
STATUS_TIMEOUT_SECONDS = 30

_URL_PATTERN = re.compile(r"https://\S*(?:anthropic|claude)\.\S*", re.IGNORECASE)

#: Only one login may run at a time.
_login_lock = asyncio.Lock()
_active_login: asyncio.subprocess.Process | None = None


def _require_cli() -> str:
    cli = find_cli()
    if not cli:
        raise RpcException(
            "Claude is not installed on this machine. Install it, then sign in from Settings.",
            ErrorCode.ENGINE_ERROR,
            {"reason": "cli-missing"},
        )
    return cli


async def _run(args: list[str], timeout: float) -> tuple[int, str, str]:
    cli = _require_cli()
    process = await asyncio.create_subprocess_exec(
        cli,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=cli_env(),
        cwd=str(session_dir()),
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError:
        process.kill()
        raise RpcException(
            f"`claude {' '.join(args)}` timed out after {timeout:.0f}s", ErrorCode.TIMEOUT
        ) from None

    return (
        process.returncode or 0,
        stdout.decode("utf-8", "replace"),
        stderr.decode("utf-8", "replace"),
    )


async def status() -> dict[str, Any]:
    """Sign-in state of the sandboxed session."""
    if not find_cli():
        return {
            "installed": False,
            "loggedIn": False,
            "sessionDir": str(session_dir()),
            "error": "Claude is not installed on this machine.",
        }

    code, stdout, stderr = await _run(["auth", "status", "--json"], STATUS_TIMEOUT_SECONDS)

    try:
        payload = json.loads(stdout or "{}")
    except json.JSONDecodeError:
        # A non-JSON reply means the CLI could not report at all; treat as signed out
        # rather than failing the whole settings screen.
        log.warning("Unparsable auth status (exit %d): %s", code, (stdout or stderr)[:200])
        payload = {}

    return {
        "installed": True,
        "loggedIn": bool(payload.get("loggedIn")),
        "email": payload.get("email"),
        "organization": payload.get("orgName"),
        "plan": payload.get("subscriptionType"),
        "authMethod": payload.get("authMethod"),
        "sessionDir": str(session_dir()),
    }


async def login(on_event: Callable[[str, dict[str, Any]], None] | None = None) -> dict[str, Any]:
    """Start the interactive sign-in and wait for it to finish.

    ``on_event`` receives ("url", {...}) as soon as the authorisation link is
    printed, then ("output", {...}) for each subsequent line.
    """
    global _active_login

    if _login_lock.locked():
        raise RpcException("A sign-in is already in progress", ErrorCode.ENGINE_ERROR)

    async with _login_lock:
        cli = _require_cli()
        process = await asyncio.create_subprocess_exec(
            cli,
            "auth",
            "login",
            "--claudeai",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=cli_env(),
            cwd=str(session_dir()),
        )
        _active_login = process
        assert process.stdout is not None

        url: str | None = None
        lines: list[str] = []

        async def pump() -> None:
            nonlocal url
            async for raw in process.stdout:  # type: ignore[union-attr]
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                lines.append(line)

                if url is None:
                    match = _URL_PATTERN.search(line)
                    if match:
                        url = match.group(0).rstrip(".,)")
                        log.info("Claude sign-in URL issued")
                        if on_event:
                            on_event("url", {"url": url})
                        continue

                if on_event:
                    on_event("output", {"line": line})

        try:
            await asyncio.wait_for(pump(), timeout=LOGIN_TIMEOUT_SECONDS)
            await asyncio.wait_for(process.wait(), timeout=30)
        except TimeoutError:
            process.kill()
            raise RpcException(
                "Sign-in timed out. Start it again and complete the browser step.",
                ErrorCode.TIMEOUT,
            ) from None
        finally:
            _active_login = None

        result = await status()
        if not result.get("loggedIn"):
            detail = " ".join(lines[-3:])[:300] or "no output"
            raise RpcException(f"Sign-in did not complete: {detail}", ErrorCode.ENGINE_ERROR)

        log.info("Signed in to the sandboxed Claude session as %s", result.get("email"))
        return result


async def submit_code(code: str) -> None:
    """Forward an authorisation code to a sign-in that is waiting for one."""
    process = _active_login
    if process is None or process.stdin is None:
        raise RpcException("No sign-in is waiting for a code", ErrorCode.ENGINE_ERROR)
    process.stdin.write(f"{code.strip()}\n".encode())
    await process.stdin.drain()


def cancel() -> bool:
    """Abort an in-flight sign-in."""
    global _active_login
    process = _active_login
    if process is None:
        return False
    process.kill()
    _active_login = None
    return True


async def logout() -> dict[str, Any]:
    """Sign out of the sandboxed session only — the global one is untouched."""
    code, stdout, stderr = await _run(["auth", "logout"], STATUS_TIMEOUT_SECONDS)
    if code != 0:
        log.warning("auth logout exited %d: %s", code, (stderr or stdout)[:200])
    return await status()
