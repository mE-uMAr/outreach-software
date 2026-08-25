"""Shared fixtures.

Every test that touches storage gets its own data directory. The engine resolves
that directory once and caches it, so the cache is reset alongside it — otherwise
the first test to run would pin the location for the whole session.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from engine.core import config, db


@pytest.fixture()
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point the engine at a throwaway data directory with a fresh database."""
    home = tmp_path / "data"
    home.mkdir(parents=True, exist_ok=True)

    # user_data_dir() reads these; which one it reads depends on the platform.
    monkeypatch.setenv("APPDATA", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home))

    # Settings is a slots dataclass, so the cached instance is replaced outright
    # rather than patched — and the cache is what every caller resolves through.
    monkeypatch.setattr(config, "_settings", config.Settings(data_dir=home), raising=False)
    monkeypatch.setattr(db, "_initialised", False, raising=False)

    db.initialize()
    yield home

    monkeypatch.setattr(config, "_settings", None, raising=False)


@pytest.fixture()
def unset_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear engine env overrides so a developer's shell cannot skew a test."""
    for name in (
        "LINKEDIN_OUTREACH_PROVIDER",
        "LINKEDIN_OUTREACH_CLAUDE_CLI",
        "PLAYWRIGHT_BROWSERS_PATH",
    ):
        monkeypatch.delenv(name, raising=False)
    assert "LINKEDIN_OUTREACH_PROVIDER" not in os.environ
