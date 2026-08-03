"""Engine configuration and on-disk locations.

Settings are layered: defaults < config.json in the user data dir < environment.
Secrets (API keys) are intentionally *not* written to config.json by default —
they live in the environment or, later, in the OS keychain.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

APP_NAME = "linkedin-outreach"
ENGINE_VERSION = "0.1.0"


def user_data_dir() -> Path:
    """Match Electron's app.getPath('userData') so both sides agree on one home."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / "linkedin-outreach"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "linkedin-outreach"
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "linkedin-outreach"


@dataclass(slots=True)
class Settings:
    data_dir: Path = field(default_factory=user_data_dir)
    default_provider: str = "claude"
    default_model: str = ""
    request_timeout_seconds: float = 120.0
    providers: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def config_path(self) -> Path:
        return self.data_dir / "config.json"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "outreach.db"

    def api_key(self, provider: str) -> str | None:
        """Resolve a provider key, if that provider still uses one."""
        configured = self.providers.get(provider, {}).get("apiKey")
        if configured:
            return str(configured)

        # No provider takes an API key any more; Claude authenticates through
        # its own sandboxed session. Kept so callers have a stable interface.
        return None

    def to_public_dict(self) -> dict[str, Any]:
        """Serializable view with secrets reduced to a boolean."""
        return {
            "dataDir": str(self.data_dir),
            "defaultProvider": self.default_provider,
            "defaultModel": self.default_model,
            "requestTimeoutSeconds": self.request_timeout_seconds,
            "providers": {
                name: {
                    key: value for key, value in options.items() if key not in {"apiKey", "api_key"}
                }
                | {"hasApiKey": bool(self.api_key(name))}
                for name, options in self.providers.items()
            },
        }


def load_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    path = settings.config_path
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # A corrupt config must not stop the engine from booting.
            raw = {}
        settings.default_provider = raw.get("defaultProvider", settings.default_provider)
        settings.default_model = raw.get("defaultModel", settings.default_model)
        settings.request_timeout_seconds = float(
            raw.get("requestTimeoutSeconds", settings.request_timeout_seconds)
        )
        providers = raw.get("providers")
        if isinstance(providers, dict):
            settings.providers = providers

    env_provider = os.environ.get("LINKEDIN_OUTREACH_PROVIDER")
    if env_provider:
        settings.default_provider = env_provider

    return settings


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = load_settings()
    return _settings


def save_settings(patch: dict[str, Any]) -> Settings:
    """Merge a patch into config.json and refresh the cached settings."""
    settings = get_settings()
    path = settings.config_path

    current: dict[str, Any] = {}
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            current = {}

    for key, value in patch.items():
        if key == "providers" and isinstance(value, dict):
            merged = dict(current.get("providers", {}))
            for provider, options in value.items():
                merged[provider] = {**merged.get(provider, {}), **options}
            current["providers"] = merged
        else:
            current[key] = value

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, indent=2), encoding="utf-8")

    globals()["_settings"] = None
    return get_settings()
