"""Claude Code provider.

Drives the locally installed `claude` CLI in print mode (`-p`). Authentication is
whatever the user already set up with `claude login`, so their Claude
subscription is used directly and this app never sees or stores a credential.

This is the officially supported non-interactive interface to Claude Code, so it
is stable in a way that scripting the claude.ai web app would not be.

Requires Claude Code to be installed on the machine. It is the one component
that is *not* bundled with the app; when it is missing the provider reports
itself unavailable and the rest of the engine carries on.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from ....core.config import get_settings
from ....core.logging import get_logger
from ....rpc.protocol import ErrorCode, RpcException
from ..base import AIProvider, CompletionRequest, CompletionResult, Usage

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


def _candidate_paths() -> list[Path]:
    """Where Claude Code installs itself, beyond PATH."""
    home = Path.home()
    if sys.platform == "win32":
        appdata = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        return [
            home / ".local" / "bin" / "claude.exe",
            home / ".claude" / "local" / "claude.exe",
            appdata / "npm" / "claude.cmd",
            local / "Programs" / "claude" / "claude.exe",
        ]
    return [
        home / ".local" / "bin" / "claude",
        home / ".claude" / "local" / "claude",
        Path("/usr/local/bin/claude"),
        Path("/opt/homebrew/bin/claude"),
    ]


def find_cli() -> str | None:
    """Locate the Claude Code executable, honouring an explicit override."""
    override = os.environ.get("LINKEDIN_OUTREACH_CLAUDE_CLI")
    if override and Path(override).exists():
        return override

    on_path = shutil.which("claude")
    if on_path:
        return on_path

    for candidate in _candidate_paths():
        if candidate.exists():
            return str(candidate)
    return None


class ClaudeCodeProvider(AIProvider):
    name = "claude-code"
    label = "Claude Code (your subscription)"
    default_model = ""  # empty = whatever the CLI is configured to use
    requires_api_key = False

    def _cli(self) -> str:
        cli = find_cli()
        if not cli:
            raise RpcException(
                "Claude Code is not installed. Install it and run `claude login`, "
                "then reconnect from Settings.",
                ErrorCode.ENGINE_ERROR,
                {"provider": self.name},
            )
        return cli

    def is_available(self) -> tuple[bool, str | None]:
        if not find_cli():
            return False, "Claude Code CLI not found — install it and run `claude login`"
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
        log.info("Running Claude Code: %s %s", cli, " ".join(args[:4]))
        return await asyncio.create_subprocess_exec(
            cli,
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # Run from the app's data directory so the CLI never picks up project
            # context from wherever the engine happened to be started.
            cwd=str(get_settings().data_dir),
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
        return "claude-code"

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
                f"Claude Code did not respond within {timeout:.0f}s", ErrorCode.TIMEOUT
            ) from None

        if process.returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip() or "no error output"
            raise RpcException(
                f"Claude Code exited with code {process.returncode}: {detail[:400]}",
                ErrorCode.ENGINE_ERROR,
                {"provider": self.name},
            )

        try:
            payload = json.loads(stdout.decode("utf-8", "replace"))
        except json.JSONDecodeError as error:
            raise RpcException(
                f"Could not parse Claude Code output: {error}", ErrorCode.ENGINE_ERROR
            ) from error

        if payload.get("is_error"):
            raise RpcException(
                f"Claude Code reported an error: {payload.get('result', 'unknown')}",
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
                    f"Claude Code reported an error: {event.get('result', 'unknown')}",
                    ErrorCode.ENGINE_ERROR,
                )

        await process.wait()
