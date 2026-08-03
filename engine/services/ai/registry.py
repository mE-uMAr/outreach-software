"""Provider lookup.

Providers are instantiated once and reused. Adding a backend means writing the
class and appending it here — nothing else in the engine changes.
"""

from __future__ import annotations

from ...core.config import get_settings
from ...rpc.protocol import ErrorCode, RpcException
from .base import AIProvider
from .providers.anthropic import AnthropicProvider
from .providers.claude_code import ClaudeCodeProvider
from .providers.echo import EchoProvider
from .providers.openai import OpenAIProvider

_PROVIDER_CLASSES: tuple[type[AIProvider], ...] = (
    # Claude Code first: it uses the user's existing subscription and needs no
    # API key, so it is the default when the CLI is installed.
    ClaudeCodeProvider,
    EchoProvider,
    AnthropicProvider,
    OpenAIProvider,
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
