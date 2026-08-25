"""Asking Claude for a decision, and paying for it once.

Every model call in the app goes through here rather than reaching for a provider
directly, which buys three things:

* **A parsed answer.** Callers get a dict, not a string that might be wrapped in
  a markdown fence.
* **A recorded cost.** The CLI reports what each call actually cost, so the usage
  table holds real numbers rather than an estimate from a price list.
* **One place to choose a model.** Routine, well-structured decisions go to a
  fast model; open-ended judgement goes to a stronger one. Callers name the kind
  of work, not the model.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from ...core.logging import get_logger
from ...rpc.protocol import ErrorCode, RpcException
from ...store import agent_memory, settings_store
from .base import CompletionRequest, Message
from .registry import get_provider

log = get_logger(__name__)

#: Model tiers by the kind of work, resolved against the user's settings. The CLI
#: takes these aliases directly and maps them to the current model in each family.
FAST = "fast"
REASONING = "reasoning"

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


def resolve_model(tier: str, override: str | None = None) -> str | None:
    """Pick the model for a tier, honouring an explicit override."""
    if override:
        return override

    browser = settings_store.get_automation().get("browser", {})
    if tier == FAST:
        return browser.get("fastModel") or "haiku"
    if tier == REASONING:
        return browser.get("reasoningModel") or "sonnet"
    return None


def extract_json(text: str) -> dict[str, Any]:
    """Pull a JSON object out of a reply that may be wrapped or padded.

    Asking for bare JSON works nearly always; this handles the times it does not
    without spending a second call on a retry.
    """
    stripped = _FENCE.sub("", text).strip()

    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        # Fall back to the outermost braces — enough for a leading sentence or a
        # trailing note the model added anyway.
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start == -1 or end <= start:
            raise ValueError(f"No JSON object in the reply: {text[:200]!r}") from None
        parsed = json.loads(stripped[start : end + 1])

    if not isinstance(parsed, dict):
        raise ValueError(f"Expected a JSON object, got {type(parsed).__name__}")
    return parsed


async def ask_json(
    prompt: str,
    *,
    system: str | None = None,
    tier: str = FAST,
    model: str | None = None,
    images: list[Path] | None = None,
    purpose: str = "general",
    max_tokens: int = 700,
    temperature: float = 0.0,
) -> dict[str, Any]:
    """Ask for a JSON answer, record what it cost, and return it parsed."""
    provider = get_provider()
    request = CompletionRequest(
        messages=[Message(role="user", content=prompt)],
        system=system,
        model=resolve_model(tier, model),
        temperature=temperature,
        max_tokens=max_tokens,
        images=list(images or []),
        json_only=True,
        purpose=purpose,
    )

    started = time.perf_counter()
    result = await provider.complete(request)
    elapsed = round((time.perf_counter() - started) * 1000)

    agent_memory.record_usage(
        purpose,
        model=result.model,
        input_tokens=result.usage.input_tokens,
        output_tokens=result.usage.output_tokens,
        cost_usd=result.usage.cost_usd,
        had_screenshot=bool(images),
        duration_ms=elapsed,
    )

    try:
        return extract_json(result.text)
    except ValueError as error:
        log.warning("Unparsable model reply for %s: %s", purpose, result.text[:300])
        raise RpcException(
            f"Claude's reply could not be read as JSON ({error}).",
            ErrorCode.ENGINE_ERROR,
            {"purpose": purpose},
        ) from error


async def ask_text(
    prompt: str,
    *,
    system: str | None = None,
    tier: str = REASONING,
    model: str | None = None,
    purpose: str = "general",
    max_tokens: int = 1200,
    temperature: float = 0.7,
) -> str:
    """Ask for prose — a connection note, a follow-up message."""
    provider = get_provider()
    result = await provider.complete(
        CompletionRequest(
            messages=[Message(role="user", content=prompt)],
            system=system,
            model=resolve_model(tier, model),
            temperature=temperature,
            max_tokens=max_tokens,
            purpose=purpose,
        )
    )

    agent_memory.record_usage(
        purpose,
        model=result.model,
        input_tokens=result.usage.input_tokens,
        output_tokens=result.usage.output_tokens,
        cost_usd=result.usage.cost_usd,
        duration_ms=result.duration_ms,
    )
    return result.text.strip()
