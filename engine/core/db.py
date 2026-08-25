"""SQLite storage.

Design notes
------------
* One connection per call, opened from the data directory. Sync RPC handlers run
  on worker threads, and a connection cannot be shared across threads, so a
  short-lived connection per operation is both simpler and safer than a pool.
* Schema changes are versioned migrations applied through ``PRAGMA user_version``.
  They run once at startup and are idempotent, so upgrading the app upgrades the
  database with no user action.
* ``sqlite3`` is part of the Python standard library, so the frozen Windows build
  carries its own engine — nothing is required on the target machine.
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import get_settings
from .logging import get_logger

log = get_logger(__name__)

_init_lock = threading.Lock()
_initialised = False


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    sql: str


#: Applied in ascending order at startup. Append a Migration, never edit a
#: released one — an edited migration silently skips on every database that has
#: already recorded its version.
MIGRATIONS: tuple[Migration, ...] = (
    Migration(
        version=1,
        name="accounts_and_settings",
        sql="""
        -- The signed-in LinkedIn identity. `storage_state` holds the browser
        -- session (cookies + origins) encrypted at rest; see core/secrets.py.
        CREATE TABLE linkedin_accounts (
            id               TEXT PRIMARY KEY,
            member_urn       TEXT UNIQUE,
            public_id        TEXT,
            full_name        TEXT NOT NULL DEFAULT '',
            headline         TEXT NOT NULL DEFAULT '',
            email            TEXT,
            location         TEXT,
            avatar_url       TEXT,
            profile_url      TEXT,
            premium          INTEGER NOT NULL DEFAULT 0,
            sales_navigator  INTEGER NOT NULL DEFAULT 0,
            status           TEXT NOT NULL DEFAULT 'connected',
            storage_state    BLOB,
            last_verified_at TEXT,
            created_at       TEXT NOT NULL,
            updated_at       TEXT NOT NULL
        );

        -- Namespaced JSON documents: automation settings, onboarding flags, and
        -- anything else that is configuration rather than records.
        CREATE TABLE app_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """,
    ),
    Migration(
        version=2,
        name="campaigns",
        sql="""
        CREATE TABLE campaigns (
            id                 TEXT PRIMARY KEY,
            account_id         TEXT REFERENCES linkedin_accounts(id) ON DELETE CASCADE,
            name               TEXT NOT NULL,
            source             TEXT NOT NULL DEFAULT 'sales-navigator',
            status             TEXT NOT NULL DEFAULT 'draft',
            search_url         TEXT,
            target_prospects   INTEGER NOT NULL DEFAULT 0,
            daily_target       INTEGER NOT NULL DEFAULT 0,
            auto_planned       INTEGER NOT NULL DEFAULT 1,
            connections_sent   INTEGER NOT NULL DEFAULT 0,
            start_date         TEXT,
            estimated_end_date TEXT,
            analysis           TEXT,
            created_at         TEXT NOT NULL,
            updated_at         TEXT NOT NULL
        );
        CREATE INDEX idx_campaigns_status  ON campaigns(status);
        CREATE INDEX idx_campaigns_created ON campaigns(created_at DESC);

        CREATE TABLE prospects (
            id              TEXT PRIMARY KEY,
            campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
            member_urn      TEXT,
            public_id       TEXT,
            full_name       TEXT NOT NULL DEFAULT '',
            headline        TEXT,
            company         TEXT,
            location        TEXT,
            profile_url     TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'queued',
            invited_at      TEXT,
            accepted_at     TEXT,
            replied_at      TEXT,
            followups_sent  INTEGER NOT NULL DEFAULT 0,
            last_followup_at TEXT,
            note            TEXT,
            error           TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            -- The profile URL is the natural key; re-importing a search must not
            -- queue the same person twice.
            UNIQUE (campaign_id, profile_url)
        );
        CREATE INDEX idx_prospects_campaign ON prospects(campaign_id, status);

        CREATE TABLE activity_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT,
            prospect_id TEXT,
            kind        TEXT NOT NULL,
            message     TEXT NOT NULL,
            detail      TEXT,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX idx_activity_created ON activity_log(created_at DESC);
        """,
    ),
    Migration(
        version=3,
        name="agent_memory",
        sql="""
        -- Cached page understanding. A page whose accessibility structure matches
        -- one already solved is replayed from here instead of costing a model
        -- call; see services/browser/agent.py.
        CREATE TABLE agent_plans (
            signature    TEXT PRIMARY KEY,
            goal         TEXT NOT NULL,
            url_pattern  TEXT,
            plan         TEXT NOT NULL,
            model        TEXT,
            hits         INTEGER NOT NULL DEFAULT 0,
            failures     INTEGER NOT NULL DEFAULT 0,
            last_used_at TEXT,
            created_at   TEXT NOT NULL
        );
        CREATE INDEX idx_agent_plans_goal ON agent_plans(goal, last_used_at DESC);

        -- Every model call the app makes, so the cost of automation is visible
        -- rather than inferred.
        CREATE TABLE ai_usage (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            at            TEXT NOT NULL,
            purpose       TEXT NOT NULL,
            model         TEXT,
            input_tokens  INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd      REAL NOT NULL DEFAULT 0,
            cache_hit     INTEGER NOT NULL DEFAULT 0,
            had_screenshot INTEGER NOT NULL DEFAULT 0,
            duration_ms   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_ai_usage_at ON ai_usage(at DESC);
        """,
    ),
)

SCHEMA_VERSION = MIGRATIONS[-1].version if MIGRATIONS else 0


def database_path() -> Path:
    return get_settings().database_path


def now() -> str:
    """UTC timestamp in the one format every column in this schema uses."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@contextmanager
def connect(readonly: bool = False) -> Iterator[sqlite3.Connection]:
    """Open a connection, commit on success, roll back on failure."""
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(path, timeout=15.0, isolation_level="DEFERRED")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    # WAL lets reads continue during a write, which matters once the automation
    # loop is writing while the UI is reading.
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 15000")

    try:
        yield connection
        if not readonly:
            connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _current_version(connection: sqlite3.Connection) -> int:
    return int(connection.execute("PRAGMA user_version").fetchone()[0])


def initialize() -> dict[str, Any]:
    """Create or upgrade the database. Safe to call more than once."""
    global _initialised

    with _init_lock, connect() as connection:
        version = _current_version(connection)
        applied: list[str] = []

        for migration in MIGRATIONS:
            if migration.version <= version:
                continue
            log.info("Applying migration %d (%s)", migration.version, migration.name)
            connection.executescript(migration.sql)
            # executescript commits and ends any open transaction, so the version
            # bump has to follow it rather than share a transaction.
            connection.execute(f"PRAGMA user_version = {migration.version}")
            applied.append(f"{migration.version}:{migration.name}")

        final_version = _current_version(connection)
        _initialised = True

    if applied:
        log.info("Database ready at %s (schema v%d)", database_path(), final_version)
    return {
        "path": str(database_path()),
        "schemaVersion": final_version,
        "expectedVersion": SCHEMA_VERSION,
        "applied": applied,
    }


def is_initialised() -> bool:
    return _initialised


def info() -> dict[str, Any]:
    """Schema version, table row counts and file size."""
    path = database_path()
    with connect(readonly=True) as connection:
        version = _current_version(connection)
        tables = [
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                " ORDER BY name"
            )
        ]
        counts = {
            table: connection.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            for table in tables
        }

    return {
        "path": str(path),
        "exists": path.exists(),
        "sizeBytes": path.stat().st_size if path.exists() else 0,
        "schemaVersion": version,
        "expectedVersion": SCHEMA_VERSION,
        "sqliteVersion": sqlite3.sqlite_version,
        "tables": counts,
    }
