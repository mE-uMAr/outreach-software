"""Anthropic Messages API provider (direct HTTP, no vendor SDK).

Talking to the REST endpoint with httpx keeps the frozen Windows binary small and
avoids SDK version drift inside PyInstaller.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

from ....core.config import get_settings
from ....rpc.protocol import ErrorCode, RpcException
from ..base import AIProvider, CompletionRequest, CompletionResult, Usage
from ..http import httpx_available, require_httpx

if TYPE_CHECKING:
    import httpx

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


class AnthropicProvider(AIProvider):
    name = "anthropic"
    label = "Anthropic (Claude)"
    default_model = "claude-sonnet-4-5"
    requires_api_key = True

    def _api_key(self) -> str | None:
        return get_settings().api_key(self.name)

    def is_available(self) -> tuple[bool, str | None]:
        if not httpx_available():
            return False, "httpx is not installed"
        if not self._api_key():
            return False, "No API key configured (set ANTHROPIC_API_KEY or save one in settings)"
        return True, None

    def _headers(self) -> dict[str, str]:
        key = self._api_key()
        if not key:
            raise RpcException(
                "Anthropic API key is not configured", ErrorCode.ENGINE_ERROR, {"provider": self.name}
            )
        return {
            "x-api-key": key,
            "anthropic-version": API_VERSION,
            "content-type": "application/json",
        }

    def _payload(self, request: CompletionRequest, stream: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": request.model or self.default_model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "messages": request.chat_messages(),
            "stream": stream,
        }
        system = request.system_prompt()
        if system:
            payload["system"] = system
        return payload

    @staticmethod
    def _raise_for_status(response: httpx.Response, body: str) -> None:
        if response.status_code < 400:
            return
        message = body
        try:
            parsed = json.loads(body)
            message = parsed.get("error", {}).get("message", body)
        except json.JSONDecodeError:
            pass
        raise RpcException(
            f"Anthropic API error ({response.status_code}): {message}",
            ErrorCode.ENGINE_ERROR,
            {"provider": "anthropic", "status": response.status_code},
        )

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        httpx = require_httpx()
        timeout = get_settings().request_timeout_seconds
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(
                    API_URL, headers=self._headers(), json=self._payload(request, stream=False)
                )
            except httpx.HTTPError as error:
                raise RpcException(f"Anthropic request failed: {error}") from error

            self._raise_for_status(response, response.text)
            data = response.json()

        text = "".join(
            block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"
        )
        usage = data.get("usage", {})
        return CompletionResult(
            text=text,
            model=data.get("model", request.model or self.default_model),
            provider=self.name,
            usage=Usage(
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            ),
            stop_reason=data.get("stop_reason"),
        )

    async def stream(self, request: CompletionRequest) -> AsyncIterator[str]:
        httpx = require_httpx()
        timeout = get_settings().request_timeout_seconds
        async with (
            httpx.AsyncClient(timeout=timeout) as client,
            client.stream(
                "POST", API_URL, headers=self._headers(), json=self._payload(request, stream=True)
            ) as response,
        ):
            if response.status_code >= 400:
                self._raise_for_status(response, (await response.aread()).decode("utf-8"))

            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield delta.get("text", "")
