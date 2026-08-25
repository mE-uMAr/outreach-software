"""ai.* methods — provider discovery and completions."""

from __future__ import annotations

import time
import uuid
from typing import Any

from ...rpc.protocol import ErrorCode, InvalidParams, RpcException
from ...rpc.registry import method
from ...rpc.server import RpcContext
from . import auth, session
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
        "model": request.model or backend.default_model or backend.name,
    }


# ------------------------------------------------------------------- sign-in


@method("ai.authStatus")
async def ai_auth_status() -> dict[str, Any]:
    """Whether the app's sandboxed Claude session is signed in."""
    return await auth.status()


@method("ai.login")
async def ai_login(ctx: RpcContext) -> dict[str, Any]:
    """Start the Claude sign-in and wait for it to complete.

    The authorisation link arrives as an `ai.login.url` notification so the app
    can open a browser; progress lines follow as `ai.login.output`.
    """

    def on_event(kind: str, payload: dict[str, Any]) -> None:
        ctx.notify(f"ai.login.{kind}", payload)

    result = await auth.login(on_event)
    ctx.notify("ai.login.complete", result)
    return result


@method("ai.submitLoginCode")
async def ai_submit_login_code(code: str) -> dict[str, Any]:
    """Pass an authorisation code to a sign-in that is waiting for one."""
    await auth.submit_code(code)
    return {"submitted": True}


@method("ai.cancelLogin")
def ai_cancel_login() -> dict[str, Any]:
    """Abort an in-flight sign-in."""
    return {"cancelled": auth.cancel()}


@method("ai.logout")
async def ai_logout() -> dict[str, Any]:
    """Sign out of the app's session. The machine's own Claude login is untouched."""
    return await auth.logout()


@method("ai.installCli")
async def ai_install_cli(ctx: RpcContext) -> dict[str, Any]:
    """Install Claude on this machine with Anthropic's own installer.

    Claude is not bundled inside this app: it is proprietary software under
    Anthropic's commercial terms, so redistributing it is not ours to do. This
    turns "go and install Claude yourself" into one button, and leaves Claude
    updating on Anthropic's schedule rather than frozen at whatever we shipped.
    """

    def on_output(line: str) -> None:
        ctx.progress(line)

    try:
        result = await session.install_cli(on_output)
    except RuntimeError as error:
        raise RpcException(str(error), ErrorCode.ENGINE_ERROR) from error

    ctx.notify("ai.install.complete", result)
    return result


@method("ai.resetSession")
def ai_reset_session() -> dict[str, Any]:
    """Delete the sandboxed session directory outright."""
    return {"cleared": session.clear_session()}


@method("ai.testConnection")
async def ai_test_connection(
    provider: str | None = None, model: str | None = None
) -> dict[str, Any]:
    """Verify the connection by running the smallest possible real completion."""
    backend = get_provider(provider)

    available, reason = backend.is_available()
    if not available:
        return {"ok": False, "provider": backend.name, "error": reason}

    request = CompletionRequest(
        messages=[Message(role="user", content="Reply with the single word: ok")],
        model=model,
        max_tokens=16,
        temperature=0,
    )

    started = time.perf_counter()
    try:
        result = await backend.complete(request)
    except RpcException as error:
        return {"ok": False, "provider": backend.name, "error": error.message}

    return {
        "ok": True,
        "provider": backend.name,
        "model": result.model,
        "latencyMs": round((time.perf_counter() - started) * 1000),
        "reply": result.text.strip()[:120],
        "usage": result.usage.to_dict(),
    }
