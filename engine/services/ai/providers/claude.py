"""Claude provider.

Runs the local Claude CLI in print mode (`-p`) against the app's own sandboxed
session, so the user's Anthropic subscription is used directly and no API key is
ever collected or stored.

The session lives in the app's data directory (see session.py), which keeps it
separate from any Claude login already on the machine.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from ....core.config import get_settings
from ....core.logging import get_logger
from ....rpc.protocol import ErrorCode, RpcException
from ..base import AIProvider, CompletionRequest, CompletionResult, Usage
from ..session import cli_env, find_cli, session_dir

log = get_logger(__name__)

#: Tools are disabled: this provider generates outreach copy, it does not need
#: to touch the user's filesystem, shell or network.
DISALLOWED_TOOLS = (
    "Bash",
    "Edit",
    "Write",
    "Read",
    "WebFetch",
    "WebSearch",
    "NotebookEdit",
    "Task",
)


class ClaudeProvider(AIProvider):
    name = "claude"
    label = "Claude"
    default_model = ""  # empty = whatever the CLI is configured to use
    requires_api_key = False

    def _cli(self) -> str:
        cli = find_cli()
        if not cli:
            raise RpcException(
                "Claude is not installed on this machine.",
                ErrorCode.ENGINE_ERROR,
                {"provider": self.name, "reason": "cli-missing"},
            )
        return cli

    def is_available(self) -> tuple[bool, str | None]:
        if not find_cli():
            return False, "Claude is not installed on this machine"
        return True, None

    def _build_args(self, request: CompletionRequest, stream: bool) -> list[str]:
        args = [
            "--print",
            "--output-format",
            "stream-json" if stream else "json",
            "--disallowed-tools",
            *DISALLOWED_TOOLS,
        ]

        if stream:
            # stream-json requires verbose; partial messages give token-level deltas.
            args += ["--verbose", "--include-partial-messages"]

        model = request.model or get_settings().default_model
        if model:
            args += ["--model", model]

        system = request.system_prompt()
        if system:
            args += ["--append-system-prompt", system]

        return args

    def _prompt(self, request: CompletionRequest) -> str:
        """Flatten the conversation into a single prompt.

        Print mode takes one prompt rather than a message array, so prior turns
        are replayed as a labelled transcript.
        """
        turns = [message for message in request.messages if message.role != "system"]
        if len(turns) == 1:
            return turns[0].content

        lines = []
        for message in turns:
            speaker = "Human" if message.role == "user" else "Assistant"
            lines.append(f"{speaker}: {message.content}")
        lines.append("Assistant:")
        return "\n\n".join(lines)

    async def _spawn(self, args: list[str], prompt: str) -> asyncio.subprocess.Process:
        cli = self._cli()
        log.info("Running Claude: %s %s", cli, " ".join(args[:4]))
        return await asyncio.create_subprocess_exec(
            cli,
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # cli_env() pins CLAUDE_CONFIG_DIR to the app's sandboxed session, and
            # running from that directory keeps the CLI from picking up project
            # context from wherever the engine happened to start.
            env=cli_env(),
            cwd=str(session_dir()),
        )

    @staticmethod
    def _usage_from(payload: dict[str, Any]) -> Usage:
        usage = payload.get("usage") or {}
        return Usage(
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
        )

    @staticmethod
    def _model_from(payload: dict[str, Any]) -> str:
        models = payload.get("modelUsage") or {}
        # The main model is the one that produced the most output.
        if models:
            return max(models, key=lambda name: models[name].get("outputTokens", 0))
        return "claude"

    async def complete(self, request: CompletionRequest) -> CompletionResult:
        args = self._build_args(request, stream=False)
        process = await self._spawn(args, self._prompt(request))

        timeout = get_settings().request_timeout_seconds
        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(self._prompt(request).encode("utf-8")), timeout=timeout
            )
        except TimeoutError:
            process.kill()
            raise RpcException(
                f"Claude did not respond within {timeout:.0f}s", ErrorCode.TIMEOUT
            ) from None

        if process.returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip() or "no error output"
            raise RpcException(
                f"Claude exited with code {process.returncode}: {detail[:400]}",
                ErrorCode.ENGINE_ERROR,
                {"provider": self.name},
            )

        try:
            payload = json.loads(stdout.decode("utf-8", "replace"))
        except json.JSONDecodeError as error:
            raise RpcException(
                f"Could not parse Claude output: {error}", ErrorCode.ENGINE_ERROR
            ) from error

        if payload.get("is_error"):
            raise RpcException(
                f"Claude reported an error: {payload.get('result', 'unknown')}",
                ErrorCode.ENGINE_ERROR,
                {"provider": self.name, "subtype": payload.get("subtype")},
            )

        return CompletionResult(
            text=payload.get("result", ""),
            model=self._model_from(payload),
            provider=self.name,
            usage=self._usage_from(payload),
            stop_reason=payload.get("stop_reason"),
            raw={
                "sessionId": payload.get("session_id"),
                "costUsd": payload.get("total_cost_usd"),
                "durationMs": payload.get("duration_ms"),
            },
        )

    async def stream(self, request: CompletionRequest) -> AsyncIterator[str]:
        args = self._build_args(request, stream=True)
        process = await self._spawn(args, self._prompt(request))

        assert process.stdin is not None and process.stdout is not None
        process.stdin.write(self._prompt(request).encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()

        async for line in process.stdout:
            raw = line.decode("utf-8", "replace").strip()
            if not raw:
                continue
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                continue

            # Token-level deltas arrive as raw Anthropic stream events.
            if event.get("type") == "stream_event":
                inner = event.get("event", {})
                if inner.get("type") == "content_block_delta":
                    delta = inner.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield delta.get("text", "")

            elif event.get("type") == "result" and event.get("is_error"):
                raise RpcException(
                    f"Claude reported an error: {event.get('result', 'unknown')}",
                    ErrorCode.ENGINE_ERROR,
                )

        await process.wait()
