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
from pathlib import Path

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
