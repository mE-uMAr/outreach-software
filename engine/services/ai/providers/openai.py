"""OpenAI Chat Completions provider (direct HTTP).

`baseUrl` is configurable, so any Chat-Completions-compatible endpoint
(Azure-style gateways, local servers, OpenRouter) works through this class.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

from ....core.config import get_settings
from ....rpc.protocol import ErrorCode, RpcException
from ..base import AIProvider, CompletionRequest, CompletionResult, Usage
from ..http import httpx_available, require_httpx

if TYPE_CHECKING:
    import httpx

DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAIProvider(AIProvider):
    name = "openai"
    label = "OpenAI"
    default_model = "gpt-4o-mini"
    requires_api_key = True

    def _api_key(self) -> str | None:
        return get_settings().api_key(self.name)

    def _base_url(self) -> str:
        configured = get_settings().providers.get(self.name, {}).get("baseUrl")
        return str(configured or DEFAULT_BASE_URL).rstrip("/")

    def is_available(self) -> tuple[bool, str | None]:
        if not httpx_available():
            return False, "httpx is not installed"
        if not self._api_key():
            return False, "No API key configured (set OPENAI_API_KEY or save one in settings)"
        return True, None

    def _headers(self) -> dict[str, str]:
        key = self._api_key()
        if not key:
            raise RpcException(
                "OpenAI API key is not configured", ErrorCode.ENGINE_ERROR, {"provider": self.name}
            )
        return {"authorization": f"Bearer {key}", "content-type": "application/json"}

    def _payload(self, request: CompletionRequest, stream: bool) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        system = request.system_prompt()
        if system:
            messages.append({"role": "system", "content": system})
        messages.extend(request.chat_messages())

        payload: dict[str, Any] = {
            "model": request.model or self.default_model,
            "messages": messages,
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": stream,
        }
        if stream:
            payload["stream_options"] = {"include_usage": True}
        return payload

    @staticmethod
    def _raise_for_status(response: httpx.Response, body: str) -> None:
        if response.status_code < 400:
            return
        message = body
        with contextlib.suppress(json.JSONDecodeError):
            message = json.loads(body).get("error", {}).get("message", body)
        raise RpcException(
            f"OpenAI API error ({response.status_code}): {message}",
            ErrorCode.ENGINE_ERROR,
            {"provider": "openai", "status": response.status_code},
        )

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        httpx = require_httpx()
        timeout = get_settings().request_timeout_seconds
        url = f"{self._base_url()}/chat/completions"
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(
                    url, headers=self._headers(), json=self._payload(request, stream=False)
                )
            except httpx.HTTPError as error:
                raise RpcException(f"OpenAI request failed: {error}") from error

            self._raise_for_status(response, response.text)
            data = response.json()

        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage", {})
        return CompletionResult(
            text=choice.get("message", {}).get("content", "") or "",
            model=data.get("model", request.model or self.default_model),
            provider=self.name,
            usage=Usage(
                input_tokens=usage.get("prompt_tokens", 0),
                output_tokens=usage.get("completion_tokens", 0),
            ),
            stop_reason=choice.get("finish_reason"),
        )

    async def stream(self, request: CompletionRequest) -> AsyncIterator[str]:
        httpx = require_httpx()
        timeout = get_settings().request_timeout_seconds
        url = f"{self._base_url()}/chat/completions"
        async with (
            httpx.AsyncClient(timeout=timeout) as client,
            client.stream(
                "POST", url, headers=self._headers(), json=self._payload(request, stream=True)
            ) as response,
        ):
            if response.status_code >= 400:
                self._raise_for_status(response, (await response.aread()).decode("utf-8"))

            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                for choice in event.get("choices", []):
                    delta = choice.get("delta", {}).get("content")
                    if delta:
                        yield delta
