"""Provider abstraction.

A provider turns a normalized chat request into text. Streaming is expressed as
an async generator of deltas so the RPC layer can forward chunks as notifications
without knowing anything about the vendor's wire format.
"""

from __future__ import annotations

import abc
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant"]


@dataclass(slots=True)
class Message:
    role: Role
    content: str

    @classmethod
    def from_dict(cls, raw: Any) -> Message:
        if not isinstance(raw, dict):
            raise ValueError("Each message must be an object with role and content")
        role = raw.get("role", "user")
        if role not in ("system", "user", "assistant"):
            raise ValueError(f"Unsupported message role: {role!r}")
        content = raw.get("content", "")
        if not isinstance(content, str):
            raise ValueError("Message content must be a string")
        return cls(role=role, content=content)

    def to_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


@dataclass(slots=True)
class CompletionRequest:
    messages: list[Message]
    model: str | None = None
    system: str | None = None
    temperature: float = 0.7
    max_tokens: int = 1024
    metadata: dict[str, Any] = field(default_factory=dict)

    def chat_messages(self) -> list[dict[str, str]]:
        """Messages without the system prompt, which providers take separately."""
        return [message.to_dict() for message in self.messages if message.role != "system"]

    def system_prompt(self) -> str | None:
        if self.system:
            return self.system
        inline = [message.content for message in self.messages if message.role == "system"]
        return "\n\n".join(inline) if inline else None


@dataclass(slots=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    def to_dict(self) -> dict[str, int]:
        return {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "totalTokens": self.input_tokens + self.output_tokens,
        }


@dataclass(slots=True)
class CompletionResult:
    text: str
    model: str
    provider: str
    usage: Usage = field(default_factory=Usage)
    stop_reason: str | None = None
    raw: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "model": self.model,
            "provider": self.provider,
            "usage": self.usage.to_dict(),
            "stopReason": self.stop_reason,
        }


class AIProvider(abc.ABC):
    """Base class for every AI backend."""

    #: Stable identifier used in configuration and RPC params.
    name: str = "base"
    #: Human-readable label for the UI.
    label: str = "Base provider"
    #: Model used when the caller does not specify one.
    default_model: str = ""
    #: Whether the provider needs an API key to function.
    requires_api_key: bool = True

    @abc.abstractmethod
    async def complete(self, request: CompletionRequest) -> CompletionResult:
        """Run a single non-streaming completion."""

    async def stream(self, request: CompletionRequest) -> AsyncIterator[str]:
        """Yield text deltas.

        The default implementation falls back to a single chunk so providers can
        opt into real streaming incrementally.
        """
        result = await self.complete(request)
        yield result.text

    def is_available(self) -> tuple[bool, str | None]:
        """Report whether the provider can run right now, and why not if it can't."""
        return True, None

    def describe(self) -> dict[str, Any]:
        available, reason = self.is_available()
        return {
            "name": self.name,
            "label": self.label,
            "defaultModel": self.default_model,
            "requiresApiKey": self.requires_api_key,
            "available": available,
            "unavailableReason": reason,
        }
