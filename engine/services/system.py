"""system.* methods — handshake, health and configuration."""

from __future__ import annotations

import os
import platform
import sys
import time
from typing import Any

from ..core.config import ENGINE_VERSION, get_settings, save_settings
from ..rpc.registry import method, registry

_STARTED_AT = time.time()


@method("system.info")
def system_info() -> dict[str, Any]:
    """Engine identity and runtime — used as the startup handshake."""
    return {
        "version": ENGINE_VERSION,
        "python": platform.python_version(),
        "platform": sys.platform,
        "machine": platform.machine(),
        "pid": os.getpid(),
        "frozen": getattr(sys, "frozen", False),
        "executable": sys.executable,
        "startedAt": _STARTED_AT,
    }


@method("system.ping")
def system_ping(payload: Any = None) -> dict[str, Any]:
    """Round-trip check; echoes the payload back with a server timestamp."""
    return {"pong": True, "at": time.time(), "payload": payload}


@method("system.health")
def system_health() -> dict[str, Any]:
    """Uptime plus a quick look at whether the data directory is writable."""
    settings = get_settings()
    data_dir_ok = os.access(settings.data_dir, os.W_OK)
    return {
        "ok": data_dir_ok,
        "uptimeSeconds": round(time.time() - _STARTED_AT, 3),
        "dataDir": str(settings.data_dir),
        "dataDirWritable": data_dir_ok,
    }


@method("system.methods")
def system_methods() -> list[dict[str, str]]:
    """List every RPC method the engine exposes."""
    return registry.describe()


@method("system.getConfig")
def system_get_config() -> dict[str, Any]:
    """Current settings with API keys reduced to a hasApiKey flag."""
    return get_settings().to_public_dict()


@method("system.setConfig")
def system_set_config(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge a patch into config.json and return the refreshed settings."""
    if not isinstance(patch, dict):
        raise ValueError("patch must be an object")
    return save_settings(patch).to_public_dict()
