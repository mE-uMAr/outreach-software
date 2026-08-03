"""Provider lookup.

Providers are instantiated once and reused. Adding a backend means writing the
class and appending it here — nothing else in the engine changes.
"""

from __future__ import annotations

from ...core.config import get_settings
from ...rpc.protocol import ErrorCode, RpcException
from .base import AIProvider
from .providers.claude import ClaudeProvider
from .providers.echo import EchoProvider

#: Claude is the only real backend — the app authenticates with an Anthropic
#: account rather than collecting API keys. `echo` stays as an offline stand-in
#: so the UI and tests run with no network and no sign-in.
_PROVIDER_CLASSES: tuple[type[AIProvider], ...] = (
    ClaudeProvider,
    EchoProvider,
)

_instances: dict[str, AIProvider] = {}


def _ensure_instances() -> dict[str, AIProvider]:
    if not _instances:
        for provider_class in _PROVIDER_CLASSES:
            instance = provider_class()
            _instances[instance.name] = instance
    return _instances


def available_providers() -> list[AIProvider]:
    return list(_ensure_instances().values())


def get_provider(name: str | None = None) -> AIProvider:
    """Resolve a provider by name, falling back to the configured default."""
    instances = _ensure_instances()
    resolved = name or get_settings().default_provider

    provider = instances.get(resolved)
    if provider is None:
        raise RpcException(
            f'Unknown AI provider "{resolved}". Known providers: {", ".join(sorted(instances))}',
            ErrorCode.INVALID_PARAMS,
        )
    return provider
