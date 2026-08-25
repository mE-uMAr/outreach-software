"""What the model is shown about a page.

The expensive part of browser automation is not the browsing — it is paying a
model to look at a page. Everything here exists to make that look as cheap as it
can be while still being enough to act on:

* **The accessibility tree, not the DOM.** A LinkedIn page is roughly 2 MB of
  markup and about 900 tokens once it comes through ``snapshot.js`` — three
  orders of magnitude, with the actionable parts kept and the styling, tracking
  and layout scaffolding dropped.
* **A screenshot only when it earns its place.** An image costs roughly 1,100
  tokens at the size used here, more than the entire text snapshot. It is
  attached when the text tier could not decide, not by default. See ``Tier``.
* **A signature per page shape.** Pages of the same kind hash to the same value,
  which is what lets the agent replay a known-good action without asking the
  model anything at all.
"""

from __future__ import annotations

import hashlib
import re
import sys
import time
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ...core.config import get_settings
from ...core.logging import get_logger

if TYPE_CHECKING:  # pragma: no cover
    from playwright.async_api import Page

log = get_logger(__name__)


class Tier(StrEnum):
    """How much the model is shown, cheapest first.

    The agent starts at ``ARIA`` and only escalates when a step actually fails,
    so the expensive tiers are paid for on the pages that need them rather than
    on every page.
    """

    #: Accessibility outline only. ~700-1,100 tokens.
    ARIA = "aria"
    #: Outline plus a downscaled screenshot. ~2,000 tokens.
    VISUAL = "visual"


#: Screenshots are resized to this width before encoding. Anthropic bills images
#: at roughly (width x height) / 750 tokens, so 1024x640 is ~875 tokens — wide
#: enough to read LinkedIn's UI, small enough not to dominate the request.
SCREENSHOT_WIDTH = 1024
SCREENSHOT_QUALITY = 55

#: Where screenshots are written for the model to read. Inside the Claude session
#: directory because that is the CLI's working directory, so a relative path is
#: all the prompt needs.
SHOT_DIRNAME = "perception"

#: Routes whose trailing segment names a specific entity. Every profile is the
#: same *kind* of page, so they have to fold to one route — profiles are the
#: page a campaign visits most, and a signature that varied per person would
#: miss the plan cache on every single prospect.
_ROUTES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^/in/[^/]+"), "/in/*"),
    (re.compile(r"^/sales/lead/[^/]+"), "/sales/lead/*"),
    (re.compile(r"^/sales/company/[^/]+"), "/sales/company/*"),
    (re.compile(r"^/sales/people/[^/]+"), "/sales/people/*"),
    (re.compile(r"^/company/[^/]+"), "/company/*"),
    (re.compile(r"^/mynetwork/invite-connect/[^/]+"), "/mynetwork/invite-connect/*"),
    (re.compile(r"^/messaging/thread/[^/]+"), "/messaging/thread/*"),
)

#: Anything left over: a path segment carrying digits is an id, not structure.
_ID_SEGMENT = re.compile(r"/[^/]*\d[^/]*")


def route_of(url: str) -> str:
    """Reduce a URL to the *kind* of page it is.

    ``/in/alex-rivera-8837a1`` and ``/in/sam-okafor-1120b9`` are both ``/in/*``.
    What distinguishes two profiles is which buttons they show, and those are in
    the signature separately — so a 1st-degree profile offering "Message" still
    hashes differently from a 2nd-degree one offering "Connect".
    """
    path = url.split("?")[0].split("#")[0]
    for host_prefix in ("https://", "http://"):
        if path.startswith(host_prefix):
            path = "/" + path[len(host_prefix) :].partition("/")[2]
            break

    # A trailing slash is not a different page.
    path = path.rstrip("/") or "/"

    for pattern, replacement in _ROUTES:
        if pattern.match(path):
            return pattern.sub(replacement, path, count=1)

    return _ID_SEGMENT.sub("/*", path)


def _snapshot_source() -> str:
    """Read snapshot.js, from the source tree or from the frozen bundle."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    candidates = [
        base / "snapshot.js",
        base / "engine" / "services" / "browser" / "snapshot.js",
        Path(__file__).parent / "snapshot.js",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")
    raise FileNotFoundError(
        f"snapshot.js is missing from this build (looked in {[str(c) for c in candidates]})"
    )


#: Read once — it is the same script on every page.
_SNAPSHOT_JS: str | None = None


def snapshot_js() -> str:
    global _SNAPSHOT_JS
    if _SNAPSHOT_JS is None:
        _SNAPSHOT_JS = _snapshot_source()
    return _SNAPSHOT_JS


@dataclass(slots=True)
class Node:
    """One actionable or orienting element on the page."""

    ref: str
    role: str
    name: str
    depth: int
    interactive: bool
    states: list[str] = field(default_factory=list)
    tag: str = ""
    href: str | None = None

    def to_line(self) -> str:
        indent = "  " * min(self.depth, 6)
        parts = [self.role]
        if self.name:
            parts.append(f'"{self.name}"')
        if self.states:
            parts.append(f"[{' '.join(self.states)}]")
        parts.append(f"[ref={self.ref}]")
        return f"{indent}- {' '.join(parts)}"

    def selector(self) -> dict[str, Any]:
        """A durable way to find this element again on a later page load.

        Refs are per-snapshot, so caching one would be worthless. Role plus
        accessible name survives a reload, a re-render and most redesigns, which
        is what makes a cached plan reusable.
        """
        return {"role": self.role, "name": self.name}


@dataclass(slots=True)
class Perception:
    url: str
    title: str
    nodes: list[Node]
    text: str
    truncated: bool
    scroll: dict[str, int]
    tier: Tier
    screenshot: Path | None = None
    capture_ms: int = 0

    def node(self, ref: str) -> Node | None:
        return next((node for node in self.nodes if node.ref == ref), None)

    def outline(self) -> str:
        """The accessibility tree as the model sees it."""
        return "\n".join(node.to_line() for node in self.nodes)

    def to_prompt(self) -> str:
        """Everything the model is told about the page, in one block."""
        header = [f"URL: {self.url}", f"Title: {self.title}"]
        if self.scroll["height"] > self.scroll["viewport"] * 1.2:
            position = round(self.scroll["y"] / max(1, self.scroll["height"]) * 100)
            header.append(f"Scroll: {position}% down a page {self.scroll['height']}px tall")

        sections = ["\n".join(header), f"Page elements:\n{self.outline()}"]
        if self.truncated:
            sections.append("(The element list was truncated; scroll to reveal more.)")
        if self.text:
            sections.append(f"Visible text (excerpt):\n{self.text}")
        return "\n\n".join(sections)

    @property
    def signature(self) -> str:
        """A stable hash of *what kind of page this is*.

        Built from the URL shape and the page's controls — buttons, tabs and
        menu items are chrome and repeat across visits, while link text is
        content and does not. Two loads of a search results page therefore agree,
        and a search page never collides with a profile page.
        """
        path = route_of(self.url)

        controls = sorted(
            {
                f"{node.role}:{node.name.lower()}"
                for node in self.nodes
                if node.role in ("button", "tab", "menuitem", "combobox", "searchbox", "textbox")
                and node.name
            }
        )
        roles = sorted({f"{node.role}={sum(1 for n in self.nodes if n.role == node.role)}" for node in self.nodes})

        digest = hashlib.blake2b(
            "|".join([path, *controls, *roles]).encode("utf-8"), digest_size=16
        )
        return digest.hexdigest()

    def estimated_tokens(self) -> int:
        """Rough token cost of this perception, for the usage log."""
        text_tokens = len(self.to_prompt()) // 4
        image_tokens = (SCREENSHOT_WIDTH * 640) // 750 if self.screenshot else 0
        return text_tokens + image_tokens


def shot_dir() -> Path:
    """Screenshot directory, inside the Claude session so the CLI can read it."""
    path = get_settings().data_dir / "claude-session" / SHOT_DIRNAME
    path.mkdir(parents=True, exist_ok=True)
    return path


async def capture(
    page: Page,
    tier: Tier = Tier.ARIA,
    *,
    max_nodes: int = 150,
    label: str = "step",
) -> Perception:
    """Snapshot a page at the requested tier."""
    started = time.perf_counter()

    raw = await page.evaluate(
        snapshot_js(),
        {"maxNodes": max_nodes, "maxNameLength": 80, "includeText": True},
    )

    nodes = [
        Node(
            ref=item["ref"],
            role=item["role"],
            name=item["name"] or "",
            depth=item["depth"],
            interactive=item["interactive"],
            states=item.get("states") or [],
            tag=item.get("tag") or "",
            href=item.get("href"),
        )
        for item in raw["nodes"]
    ]

    screenshot: Path | None = None
    if tier is Tier.VISUAL:
        screenshot = await _capture_screenshot(page, label)

    perception = Perception(
        url=raw["url"],
        title=raw["title"],
        nodes=nodes,
        text=raw.get("text") or "",
        truncated=bool(raw.get("truncated")),
        scroll=raw.get("scroll") or {"y": 0, "height": 0, "viewport": 0},
        tier=tier,
        screenshot=screenshot,
        capture_ms=round((time.perf_counter() - started) * 1000),
    )

    log.debug(
        "Captured %s: %d nodes, ~%d tokens, %dms",
        perception.url,
        len(nodes),
        perception.estimated_tokens(),
        perception.capture_ms,
    )
    return perception


async def _capture_screenshot(page: Page, label: str) -> Path | None:
    """Viewport JPEG, downscaled in the page before it is ever encoded.

    Resizing in the browser rather than in Python keeps the dependency list at
    zero — no Pillow in the frozen build — and means the large bitmap never
    crosses the process boundary.
    """
    directory = shot_dir()
    # One file per step, overwritten next run: these are scratch, and a campaign
    # would otherwise leave thousands of screenshots behind.
    target = directory / f"{re.sub(r'[^a-z0-9_-]+', '-', label.lower())}.jpg"

    try:
        raw = await page.screenshot(type="jpeg", quality=SCREENSHOT_QUALITY, full_page=False)
    except Exception as error:
        log.warning("Screenshot failed: %s", error)
        return None

    scaled = await _downscale(page, raw)
    target.write_bytes(scaled or raw)
    return target


async def _downscale(page: Page, raw: bytes) -> bytes | None:
    """Re-encode through a canvas at SCREENSHOT_WIDTH."""
    import base64

    try:
        encoded = await page.evaluate(
            """
            async ({ data, width, quality }) => {
              const blob = await (await fetch(`data:image/jpeg;base64,${data}`)).blob()
              const bitmap = await createImageBitmap(blob)
              if (bitmap.width <= width) return null

              const scale = width / bitmap.width
              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = Math.round(bitmap.height * scale)
              canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
              bitmap.close()
              return canvas.toDataURL('image/jpeg', quality).split(',')[1]
            }
            """,
            {
                "data": base64.b64encode(raw).decode("ascii"),
                "width": SCREENSHOT_WIDTH,
                "quality": SCREENSHOT_QUALITY / 100,
            },
        )
    except Exception as error:
        log.warning("Could not downscale the screenshot: %s", error)
        return None

    return base64.b64decode(encoded) if encoded else None
