"""Offline provider.

Lets the whole pipeline — RPC, streaming notifications, UI — be exercised with no
API key and no network. It is the default provider until one is configured.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from ..base import AIProvider, CompletionRequest, CompletionResult, Usage


class EchoProvider(AIProvider):
    name = "echo"
    label = "Echo (offline)"
    default_model = "echo-1"
    requires_api_key = False

    def _render(self, request: CompletionRequest) -> str:
        last_user = next(
            (message.content for message in reversed(request.messages) if message.role == "user"),
            "",
        )
        system = request.system_prompt()
        lines = ["[echo provider — no model was called]"]
        if system:
            lines.append(f"system: {system.strip()[:200]}")
        lines.append(f"prompt: {last_user.strip()[:500]}")
        lines.append(f"turns: {len(request.messages)}")
        return "\n".join(lines)

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        text = self._render(request)
        return CompletionResult(
            text=text,
            model=request.model or self.default_model,
            provider=self.name,
            usage=Usage(
                input_tokens=sum(len(m.content) for m in request.messages) // 4,
                output_tokens=len(text) // 4,
            ),
            stop_reason="end_turn",
        )

    async def stream(self, request: CompletionRequest) -> AsyncIterator[str]:
        text = self._render(request)
        for word in text.split(" "):
            # A small delay makes streaming visibly incremental in the UI.
            await asyncio.sleep(0.02)
            yield word + " "
