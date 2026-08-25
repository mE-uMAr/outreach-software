"""browser.* methods — runtime setup, agent runs and cost reporting."""

from __future__ import annotations

from typing import Any

from ...rpc.registry import method
from ...rpc.server import RpcContext
from ...store import agent_memory
from .agent import BrowserAgent
from .perception import Tier, capture
from .runtime import install_runtime, runtime, runtime_status


@method("browser.status")
def browser_status() -> dict[str, Any]:
    """Whether Chromium is installed and whether it is currently open."""
    return runtime_status() | {"open": runtime.is_open}


@method("browser.install")
async def browser_install(ctx: RpcContext) -> dict[str, Any]:
    """Download the Chromium build the automation drives."""

    def on_output(line: str) -> None:
        ctx.progress(line)

    return await install_runtime(on_output)


@method("browser.close")
async def browser_close() -> dict[str, Any]:
    """Close the browser. It reopens on the next call that needs it."""
    await runtime.close()
    return {"closed": True}


@method("browser.snapshot")
async def browser_snapshot(url: str | None = None, visual: bool = False) -> dict[str, Any]:
    """Capture what the model would see for a page.

    Exposed so the perception layer can be inspected directly — the token
    estimate here is what a decision on this page actually costs.
    """
    page = await runtime.page(headless=True)
    if url:
        await page.goto(url, wait_until="domcontentloaded")

    perception = await capture(page, Tier.VISUAL if visual else Tier.ARIA, label="inspect")
    return {
        "url": perception.url,
        "title": perception.title,
        "outline": perception.outline(),
        "nodeCount": len(perception.nodes),
        "signature": perception.signature,
        "estimatedTokens": perception.estimated_tokens(),
        "captureMs": perception.capture_ms,
        "screenshot": str(perception.screenshot) if perception.screenshot else None,
    }


@method("browser.run")
async def browser_run(
    ctx: RpcContext,
    goal: str,
    url: str | None = None,
    context: str = "",
    max_steps: int | None = None,
) -> dict[str, Any]:
    """Drive the browser towards a goal, reporting each step as it happens."""
    page = await runtime.page(headless=True)
    if url:
        await page.goto(url, wait_until="domcontentloaded")

    def on_step(step: Any) -> None:
        ctx.notify(
            "browser.step",
            {
                "index": step.index,
                "action": step.action.get("action"),
                "detail": step.detail,
                "ok": step.ok,
                "fromCache": step.from_cache,
                "tier": step.tier,
            },
        )

    agent = BrowserAgent(page, on_step=on_step, max_steps=max_steps)
    result = await agent.run(goal, context=context)
    return result.to_dict()


@method("browser.usage")
def browser_usage(days: int = 30) -> dict[str, Any]:
    """What the automation has cost, and how much of it the cache absorbed."""
    return agent_memory.usage_summary(days)


@method("browser.clearPlanCache")
def browser_clear_plan_cache(goal: str | None = None) -> dict[str, Any]:
    """Forget cached page plans — use after LinkedIn changes its layout."""
    return {"cleared": agent_memory.forget_plans(goal)}
