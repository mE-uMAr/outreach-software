"""ai.* methods — provider discovery and completions."""

from __future__ import annotations

import uuid
from typing import Any

from ...rpc.protocol import InvalidParams
from ...rpc.registry import method
from ...rpc.server import RpcContext
from .base import CompletionRequest, Message
from .registry import available_providers, get_provider


def _build_request(
    messages: list[Any] | None,
    prompt: str | None,
    model: str | None,
    system: str | None,
    temperature: float,
    max_tokens: int,
) -> CompletionRequest:
    if not messages and not prompt:
        raise InvalidParams("Provide either `messages` or `prompt`")

    if messages:
        if not isinstance(messages, list):
            raise InvalidParams("`messages` must be an array")
        try:
            parsed = [Message.from_dict(item) for item in messages]
        except ValueError as error:
            raise InvalidParams(str(error)) from error
    else:
        parsed = [Message(role="user", content=str(prompt))]

    return CompletionRequest(
        messages=parsed,
        model=model,
        system=system,
        temperature=float(temperature),
        max_tokens=int(max_tokens),
    )


@method("ai.listProviders")
def ai_list_providers() -> list[dict[str, Any]]:
    """Every registered provider with its availability status."""
    return [provider.describe() for provider in available_providers()]


@method("ai.complete")
async def ai_complete(
    messages: list[Any] | None = None,
    prompt: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
) -> dict[str, Any]:
    """Run a completion and return the full text."""
    backend = get_provider(provider)
    request = _build_request(messages, prompt, model, system, temperature, max_tokens)
    result = await backend.complete(request)
    return result.to_dict()


@method("ai.stream")
async def ai_stream(
    ctx: RpcContext,
    messages: list[Any] | None = None,
    prompt: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int = 1024,
    stream_id: str | None = None,
) -> dict[str, Any]:
    """Stream a completion.

    Deltas arrive as `ai.delta` notifications tagged with `streamId`; the response
    to this call carries the assembled text once the stream ends.
    """
    backend = get_provider(provider)
    request = _build_request(messages, prompt, model, system, temperature, max_tokens)

    identifier = stream_id or f"stream_{uuid.uuid4().hex[:12]}"
    ctx.notify("ai.start", {"streamId": identifier, "provider": backend.name})

    chunks: list[str] = []
    try:
        async for delta in backend.stream(request):
            if not delta:
                continue
            chunks.append(delta)
            ctx.notify("ai.delta", {"streamId": identifier, "text": delta})
    except Exception as error:
        ctx.notify("ai.error", {"streamId": identifier, "message": str(error)})
        raise

    text = "".join(chunks)
    ctx.notify("ai.end", {"streamId": identifier, "text": text})
    return {
        "streamId": identifier,
        "text": text,
        "provider": backend.name,
        "model": request.model or backend.default_model,
    }
