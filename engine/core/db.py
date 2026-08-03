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
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
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


#: Applied in ascending order at startup. Intentionally empty — tables get added
#: as each feature is built. Append a Migration, never edit a released one:
#:
#:     Migration(
#:         version=1,
#:         name="campaigns",
#:         sql="CREATE TABLE campaigns (id TEXT PRIMARY KEY, ...);",
#:     )
MIGRATIONS: tuple[Migration, ...] = ()

SCHEMA_VERSION = MIGRATIONS[-1].version if MIGRATIONS else 0


def database_path() -> Path:
    return get_settings().database_path


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

    with _init_lock:
        with connect() as connection:
            version = _current_version(connection)
            applied: list[str] = []

            for migration in MIGRATIONS:
                if migration.version <= version:
                    continue
                log.info("Applying migration %d (%s)", migration.version, migration.name)
                connection.executescript(migration.sql)
                # executescript commits and ends any open transaction, so the
                # version bump has to follow it rather than share a transaction.
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
