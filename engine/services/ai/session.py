"""Sandboxed Claude session.

The app keeps its own Claude session inside its data directory rather than using
the machine's global one. Two reasons:

* signing in here never touches (or logs out) the user's own Claude session, and
* uninstalling the app takes its credentials with it.

Isolation is achieved with ``CLAUDE_CONFIG_DIR``, which redirects every part of
the CLI's state — credentials included — into a directory we own.
"""

from __future__ import annotations

import os
import shutil
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from ...core.config import get_settings
from ...core.logging import get_logger

log = get_logger(__name__)

#: Directory name inside the app's data directory.
SESSION_DIRNAME = "claude-session"


def session_dir() -> Path:
    """The sandboxed session directory, created on first use."""
    path = get_settings().data_dir / SESSION_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        # Credentials live here; keep it owner-only.
        path.chmod(0o700)
    return path


def _candidate_paths() -> list[Path]:
    """Install locations to check beyond PATH."""
    home = Path.home()
    if sys.platform == "win32":
        appdata = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        return [
            home / ".local" / "bin" / "claude.exe",
            home / ".claude" / "local" / "claude.exe",
            appdata / "npm" / "claude.cmd",
            local / "Programs" / "claude" / "claude.exe",
        ]
    return [
        home / ".local" / "bin" / "claude",
        home / ".claude" / "local" / "claude",
        Path("/usr/local/bin/claude"),
        Path("/opt/homebrew/bin/claude"),
    ]


def find_cli() -> str | None:
    """Locate the Claude executable, honouring an explicit override."""
    override = os.environ.get("LINKEDIN_OUTREACH_CLAUDE_CLI")
    if override and Path(override).exists():
        return override

    on_path = shutil.which("claude")
    if on_path:
        return on_path

    for candidate in _candidate_paths():
        if candidate.exists():
            return str(candidate)
    return None


def cli_env() -> dict[str, str]:
    """Environment for every CLI call: the app's session, never the global one."""
    env = dict(os.environ)
    env["CLAUDE_CONFIG_DIR"] = str(session_dir())
    # Machine-readable output only; no colour codes to parse around.
    env["NO_COLOR"] = "1"
    env["CI"] = "1"
    return env


def is_installed() -> bool:
    return find_cli() is not None


def clear_session() -> bool:
    """Delete the sandboxed session. Used as a hard reset when sign-out fails."""
    path = get_settings().data_dir / SESSION_DIRNAME
    if not path.exists():
        return False
    shutil.rmtree(path, ignore_errors=True)
    log.info("Cleared sandboxed Claude session at %s", path)
    return True

# --------------------------------------------------------------------- install

#: Anthropic's own installer. Used rather than bundling Claude inside this app:
#: Claude is proprietary software licensed under Anthropic's commercial terms,
#: so redistributing it inside an installer we ship is not ours to do. Running
#: their installer on the user's machine is — and it keeps Claude updating on
#: Anthropic's schedule rather than freezing at whatever we last shipped.
INSTALL_SCRIPT_WINDOWS = "https://claude.ai/install.ps1"
INSTALL_SCRIPT_POSIX = "https://claude.ai/install.sh"

#: Installing pulls a few hundred megabytes.
INSTALL_TIMEOUT_SECONDS = 900


async def install_cli(on_output: Callable[[str], None] | None = None) -> dict[str, Any]:
    """Install Claude on this machine using Anthropic's official installer.

    Streams the installer's output so the UI can show what is happening instead
    of an indeterminate spinner over a long download.
    """
    import asyncio

    if sys.platform == "win32":
        command = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            f"irm {INSTALL_SCRIPT_WINDOWS} | iex",
        ]
    else:
        command = ["/bin/sh", "-c", f"curl -fsSL {INSTALL_SCRIPT_POSIX} | sh"]

    log.info("Installing Claude with Anthropic's installer")
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, "NO_COLOR": "1"},
    )
    assert process.stdout is not None

    lines: list[str] = []

    async def pump() -> None:
        async for raw in process.stdout:  # type: ignore[union-attr]
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            lines.append(line)
            log.info("claude install: %s", line)
            if on_output:
                on_output(line)

    try:
        await asyncio.wait_for(pump(), timeout=INSTALL_TIMEOUT_SECONDS)
        code = await asyncio.wait_for(process.wait(), timeout=60)
    except TimeoutError:
        process.kill()
        raise RuntimeError(
            "Installing Claude timed out. Check the connection and try again."
        ) from None

    # `which` is cached by the shell, not by us, but a freshly installed CLI may
    # not be on PATH for this already-running process — so the known install
    # locations are re-checked directly.
    found = find_cli()
    if code != 0 and not found:
        detail = " ".join(lines[-3:])[:300] or "no output"
        raise RuntimeError(f"Installing Claude failed: {detail}")

    return {"installed": bool(found), "path": found, "output": lines[-5:]}
