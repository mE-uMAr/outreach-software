"""The perceive → decide → act loop.

The whole design is aimed at one number: **how many model calls does it take to
get a page-driven task done.** Three mechanisms, in the order they save money:

1. **The plan cache.** Pages of the same kind hash to the same signature. The
   second time the agent meets a page it has already solved, it replays the
   action that worked and calls no model at all. On LinkedIn — where the same
   search, profile and invite pages come round hundreds of times in a campaign —
   this is where nearly all of the saving is.
2. **A text-first tier.** The accessibility outline is about a tenth the cost of
   a screenshot. The agent decides from text alone and only attaches an image
   after a step has actually failed, so the expensive tier is paid for on the
   handful of pages that need it rather than on every page.
3. **A fast model by default.** "Which of these 40 controls do I click" is not
   hard reasoning. It goes to the fast model; the loop escalates to the stronger
   one only after the fast one has been wrong.

Each escalation is triggered by a real failure, never by a guess, and a cached
plan that stops working is evicted rather than retried — LinkedIn ships UI
changes, and a stale cache must degrade into one model call, not into a stuck
automation.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from ...core.logging import get_logger
from ...rpc.protocol import ErrorCode, RpcException
from ...store import agent_memory, settings_store
from ..ai import reason
from . import actions
from .perception import Perception, Tier, capture

if TYPE_CHECKING:  # pragma: no cover
    from playwright.async_api import Page

log = get_logger(__name__)

SYSTEM_PROMPT = """You drive a Chromium browser for a LinkedIn outreach tool.

You are given a goal and an accessibility snapshot of the current page: every \
element a person could see or act on, each with a [ref=..] handle. Sometimes a \
screenshot is attached as well.

Choose exactly ONE next action and reply with a single JSON object:

  {"action":"click","ref":"e12","description":"why this element"}
  {"action":"fill","ref":"e4","value":"text to type"}
  {"action":"press","ref":"e4","key":"Enter"}
  {"action":"select","ref":"e9","value":"option label"}
  {"action":"scroll","direction":"down","amount":600}
  {"action":"navigate","url":"https://..."}
  {"action":"wait","seconds":2}
  {"action":"extract","ref":"e7"}
  {"action":"done","summary":"what was achieved","result":{...}}
  {"action":"fail","reason":"why this cannot be completed"}

Rules:
- Prefer a ref from the snapshot. Only use role+name when no ref fits.
- One step at a time. Do not plan ahead in the reply; you will see the result.
- If the goal is already satisfied by what is on screen, answer "done" \
immediately rather than clicking anything.
- If the page shows a login wall, a captcha, or a security checkpoint, answer \
"fail" with that as the reason. Never attempt to solve one.
- Be conservative: this is a real account, and a wrong click has consequences."""


@dataclass(slots=True)
class Step:
    """One turn of the loop, kept for the run summary and the UI trail."""

    index: int
    url: str
    action: dict[str, Any]
    ok: bool
    detail: str
    from_cache: bool
    tier: str
    duration_ms: int


@dataclass(slots=True)
class RunResult:
    ok: bool
    goal: str
    summary: str
    data: Any = None
    steps: list[Step] = field(default_factory=list)
    model_calls: int = 0
    cache_hits: int = 0
    duration_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "goal": self.goal,
            "summary": self.summary,
            "data": self.data,
            "modelCalls": self.model_calls,
            "cacheHits": self.cache_hits,
            "durationMs": self.duration_ms,
            "steps": [
                {
                    "index": step.index,
                    "url": step.url,
                    "action": step.action.get("action"),
                    "ok": step.ok,
                    "detail": step.detail,
                    "fromCache": step.from_cache,
                    "tier": step.tier,
                    "durationMs": step.duration_ms,
                }
                for step in self.steps
            ],
        }


class BrowserAgent:
    """Drives one page towards one goal."""

    def __init__(
        self,
        page: Page,
        *,
        on_step: Any = None,
        use_cache: bool | None = None,
        max_steps: int | None = None,
    ) -> None:
        self.page = page
        self.on_step = on_step

        browser_settings = settings_store.get_automation().get("browser", {})
        self.use_cache = browser_settings.get("planCache", True) if use_cache is None else use_cache
        self.max_steps = max_steps or int(browser_settings.get("maxStepsPerTask", 12))

    async def run(self, goal: str, *, context: str = "") -> RunResult:
        """Work towards `goal`, one action at a time, until done or out of steps."""
        started = time.perf_counter()
        result = RunResult(ok=False, goal=goal, summary="")

        # Escalation state. Both reset on a successful step: a single bad guess
        # should not make the rest of the run expensive.
        tier = Tier.ARIA
        use_reasoning_model = False
        consecutive_failures = 0

        for index in range(1, self.max_steps + 1):
            step_started = time.perf_counter()
            perception = await capture(self.page, tier, label=f"{goal[:24]}-{index}")

            action, from_cache, signature = await self._decide(
                goal, perception, context, use_reasoning_model
            )
            if from_cache:
                result.cache_hits += 1
            else:
                result.model_calls += 1

            outcome = await actions.execute(self.page, action)
            step = Step(
                index=index,
                url=perception.url,
                action=action,
                ok=outcome.ok,
                detail=outcome.detail,
                from_cache=from_cache,
                tier=tier.value,
                duration_ms=round((time.perf_counter() - step_started) * 1000),
            )
            result.steps.append(step)
            if self.on_step:
                self.on_step(step)

            if action["action"] in ("done", "fail"):
                result.ok = outcome.ok
                result.summary = outcome.detail or action.get("summary", "")
                result.data = outcome.data
                break

            if outcome.ok:
                consecutive_failures = 0
                tier = Tier.ARIA
                use_reasoning_model = False
                if self.use_cache and not from_cache:
                    self._remember(signature, goal, action, perception)
            else:
                consecutive_failures += 1
                if from_cache:
                    # A remembered action stopped working: drop it and let the
                    # next pass decide from scratch rather than replaying a
                    # broken plan.
                    agent_memory.record_plan_failure(signature)
                    log.info("Cached plan for %s failed; evicting it", signature[:12])
                elif consecutive_failures == 1:
                    # Text was not enough. Show the model the page.
                    tier = Tier.VISUAL
                elif consecutive_failures >= 2:
                    use_reasoning_model = True

                if consecutive_failures >= 4:
                    result.summary = f"Gave up after {consecutive_failures} failed attempts: {outcome.detail}"
                    break
        else:
            result.summary = f"Reached the {self.max_steps}-step limit without finishing"

        result.duration_ms = round((time.perf_counter() - started) * 1000)
        log.info(
            "Agent %s: %s (%d steps, %d model calls, %d cache hits, %dms)",
            "finished" if result.ok else "stopped",
            goal,
            len(result.steps),
            result.model_calls,
            result.cache_hits,
            result.duration_ms,
        )
        return result

    # ------------------------------------------------------------------ decide

    async def _decide(
        self, goal: str, perception: Perception, context: str, use_reasoning_model: bool
    ) -> tuple[dict[str, Any], bool, str]:
        """Pick the next action — from memory if possible, from Claude if not."""
        signature = perception.signature

        if self.use_cache and perception.tier is Tier.ARIA:
            cached = agent_memory.recall_plan(signature, goal)
            if cached:
                resolved = self._rehydrate(cached, perception)
                if resolved is not None:
                    log.debug("Replaying cached plan for %s", goal)
                    return resolved, True, signature

        prompt = self._build_prompt(goal, perception, context)
        answer = await reason.ask_json(
            prompt,
            system=SYSTEM_PROMPT,
            tier=reason.REASONING if use_reasoning_model else reason.FAST,
            images=[perception.screenshot] if perception.screenshot else None,
            purpose="browser.decide",
            max_tokens=400,
        )

        if "action" not in answer:
            raise RpcException(
                f"Claude did not return an action for “{goal}”.", ErrorCode.ENGINE_ERROR
            )
        return answer, False, signature

    def _build_prompt(self, goal: str, perception: Perception, context: str) -> str:
        sections = [f"Goal: {goal}"]
        if context:
            sections.append(f"Context:\n{context}")
        sections.append(perception.to_prompt())
        sections.append("What is the single next action?")
        return "\n\n".join(sections)

    # ------------------------------------------------------------------- cache

    def _remember(
        self, signature: str, goal: str, action: dict[str, Any], perception: Perception
    ) -> None:
        """Store the action in a form that will still work on a later visit.

        The ref is dropped deliberately — it belongs to the snapshot that has just
        been thrown away. What is kept is the element's role and accessible name,
        which is how the same control will be found next time.
        """
        if action["action"] in ("done", "fail"):
            return

        durable = {key: value for key, value in action.items() if key != "ref"}
        ref = action.get("ref")
        if ref:
            node = perception.node(ref)
            if node is None or not node.name:
                # Nothing durable to key on; caching this would only produce a
                # miss and a wasted lookup next time.
                return
            durable |= node.selector()

        agent_memory.remember_plan(signature, goal, durable, None)

    def _rehydrate(self, cached: dict[str, Any], perception: Perception) -> dict[str, Any] | None:
        """Point a remembered action at the element on the page in front of us."""
        role, name = cached.get("role"), cached.get("name")
        if not role:
            # Ref-free actions (scroll, navigate, wait) replay as they are.
            return cached if cached.get("action") in ("scroll", "navigate", "wait") else None

        for node in perception.nodes:
            if node.role == role and node.name == name:
                return cached | {"ref": node.ref}

        # The control is not on this page after all — the signature matched a page
        # that has since changed. Fall through to a model call.
        return None
