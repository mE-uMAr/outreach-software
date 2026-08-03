"""Runtime credential store.

Credentials live in memory only. The Electron main process owns them on disk,
encrypted with the OS keystore (DPAPI / Keychain / libsecret), and pushes them
into the engine after the startup handshake via ``ai.setCredentials``.

The engine therefore never writes a secret to disk and never returns one over
RPC — the most it will report is whether a credential is present.
"""

from __future__ import annotations

import threading

from ...core.logging import get_logger

log = get_logger(__name__)

_lock = threading.Lock()
_credentials: dict[str, str] = {}


def set_credential(provider: str, api_key: str) -> None:
    with _lock:
        if api_key:
            _credentials[provider] = api_key
        else:
            _credentials.pop(provider, None)
    log.info("Credential %s for provider %r", "set" if api_key else "cleared", provider)


def get_credential(provider: str) -> str | None:
    with _lock:
        return _credentials.get(provider)


def clear_credential(provider: str) -> None:
    set_credential(provider, "")


def has_credential(provider: str) -> bool:
    return bool(get_credential(provider))


def masked(provider: str) -> str | None:
    """Last four characters only — safe to show in the UI."""
    key = get_credential(provider)
    if not key:
        return None
    return f"…{key[-4:]}" if len(key) > 4 else "…"
