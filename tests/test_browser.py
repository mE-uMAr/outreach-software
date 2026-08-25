"""The browser layer's decision-making, without a browser.

Perception, the plan cache and the escalation ladder are the parts that decide
what the automation costs, so they are tested directly with fabricated pages
rather than only through a live Chromium.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from engine.services.browser import actions
from engine.services.browser.perception import Node, Perception, Tier, route_of
from engine.store import agent_memory


def make_node(ref: str, role: str, name: str, **extra: Any) -> Node:
    return Node(
        ref=ref,
        role=role,
        name=name,
        depth=extra.get("depth", 0),
        interactive=extra.get("interactive", role in ("button", "link", "textbox")),
        states=extra.get("states", []),
        tag=extra.get("tag", ""),
        href=extra.get("href"),
    )


def make_perception(url: str, nodes: list[Node], **extra: Any) -> Perception:
    return Perception(
        url=url,
        title=extra.get("title", "Page"),
        nodes=nodes,
        text=extra.get("text", ""),
        truncated=extra.get("truncated", False),
        scroll=extra.get("scroll", {"y": 0, "height": 900, "viewport": 900}),
        tier=extra.get("tier", Tier.ARIA),
        screenshot=extra.get("screenshot"),
    )


SEARCH_PAGE = [
    make_node("e1", "searchbox", "Search"),
    make_node("e2", "button", "Connect"),
    make_node("e3", "button", "Next"),
    make_node("e4", "link", "Alex Rivera"),
    make_node("e5", "link", "Sam Okafor"),
]


# ---------------------------------------------------------------- perception


def test_outline_is_compact_and_carries_refs() -> None:
    perception = make_perception("https://www.linkedin.com/sales/search/people", SEARCH_PAGE)
    outline = perception.outline()

    assert '- searchbox "Search" [ref=e1]' in outline
    assert '- button "Connect" [ref=e2]' in outline
    # Five elements should not cost more than a couple of hundred characters.
    assert len(outline) < 300


def test_node_states_are_reported() -> None:
    node = make_node("e9", "button", "Send", states=["disabled"])
    assert node.to_line() == '- button "Send" [disabled] [ref=e9]'


def test_prompt_mentions_scroll_position_only_when_it_matters() -> None:
    short = make_perception("https://x/a", SEARCH_PAGE)
    assert "Scroll:" not in short.to_prompt()

    long = make_perception(
        "https://x/a", SEARCH_PAGE, scroll={"y": 1200, "height": 6000, "viewport": 900}
    )
    assert "Scroll: 20%" in long.to_prompt()


def test_truncation_is_disclosed_to_the_model() -> None:
    perception = make_perception("https://x/a", SEARCH_PAGE, truncated=True)
    assert "truncated" in perception.to_prompt()


def test_node_lookup_by_ref() -> None:
    perception = make_perception("https://x/a", SEARCH_PAGE)
    found = perception.node("e2")
    assert found is not None and found.name == "Connect"
    assert perception.node("e99") is None


def test_selector_drops_the_ref_and_keeps_role_and_name() -> None:
    assert make_node("e2", "button", "Connect").selector() == {
        "role": "button",
        "name": "Connect",
    }


# ----------------------------------------------------------------- signature


def test_signature_is_stable_across_visits_to_the_same_page_type() -> None:
    """Two loads of a results page differ in content but not in shape.

    This is what makes the plan cache worth having: if the signature moved with
    the names on the page, every visit would be a miss and every step would cost
    a model call.
    """
    first = make_perception("https://www.linkedin.com/sales/search/people?page=1", SEARCH_PAGE)
    second = make_perception(
        "https://www.linkedin.com/sales/search/people?page=2",
        [
            make_node("e1", "searchbox", "Search"),
            make_node("e2", "button", "Connect"),
            make_node("e3", "button", "Next"),
            make_node("e4", "link", "Dana Whitfield"),
            make_node("e5", "link", "Priya Raman"),
        ],
    )
    assert first.signature == second.signature


def test_signature_separates_different_page_types() -> None:
    search = make_perception("https://www.linkedin.com/sales/search/people", SEARCH_PAGE)
    profile = make_perception(
        "https://www.linkedin.com/in/alex",
        [
            make_node("e1", "button", "Message"),
            make_node("e2", "button", "Follow"),
            make_node("e3", "heading", "Alex Rivera"),
        ],
    )
    assert search.signature != profile.signature


def test_signature_ignores_ids_in_the_url() -> None:
    first = make_perception("https://www.linkedin.com/in/alex-rivera-8837a1", SEARCH_PAGE)
    second = make_perception("https://www.linkedin.com/in/sam-okafor-1120b9", SEARCH_PAGE)
    # Two profile pages are the same kind of page and should share a plan.
    assert first.signature == second.signature


def test_signature_changes_when_the_controls_change() -> None:
    """A redesign must miss the cache rather than replay a plan that cannot work."""
    before = make_perception("https://x/page", SEARCH_PAGE)
    after = make_perception(
        "https://x/page",
        [make_node("e1", "searchbox", "Search"), make_node("e2", "button", "Invite")],
    )
    assert before.signature != after.signature


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.linkedin.com/in/alex-rivera-8837a1/", "/in/*"),
        ("https://www.linkedin.com/in/meharumar", "/in/*"),
        ("https://www.linkedin.com/sales/lead/12345,NAME_SEARCH", "/sales/lead/*"),
        ("https://www.linkedin.com/sales/search/people?keywords=ceo", "/sales/search/people"),
        ("https://www.linkedin.com/search/results/people/", "/search/results/people"),
        # A trailing slash is not a different page.
        ("https://www.linkedin.com/feed/", "/feed"),
        # A path with no route rule still loses its ids.
        ("https://example.com/orders/99213/items", "/orders/*/items"),
    ],
)
def test_route_reduces_a_url_to_a_page_kind(url: str, expected: str) -> None:
    assert route_of(url) == expected


def test_screenshot_dominates_the_token_estimate() -> None:
    text_only = make_perception("https://x/a", SEARCH_PAGE)
    with_image = make_perception(
        "https://x/a", SEARCH_PAGE, tier=Tier.VISUAL, screenshot=Path("shot.jpg")
    )
    assert with_image.estimated_tokens() > text_only.estimated_tokens() * 3


# ------------------------------------------------------------------ actions


def test_unknown_actions_are_refused() -> None:
    with pytest.raises(actions.ActionError):
        actions._validate({"action": "execute_javascript", "code": "alert(1)"})

    with pytest.raises(actions.ActionError):
        actions._validate({})


@pytest.mark.parametrize("kind", actions.ACTIONS)
def test_every_offered_action_validates(kind: str) -> None:
    assert actions._validate({"action": kind})[0] == kind


# ------------------------------------------------------------- plan rehydrate


class FakeAgent:
    """The two cache methods under test, lifted off BrowserAgent."""

    def __init__(self) -> None:
        from engine.services.browser.agent import BrowserAgent

        self._remember = BrowserAgent._remember.__get__(self)
        self._rehydrate = BrowserAgent._rehydrate.__get__(self)


def test_remember_stores_a_durable_selector_not_a_ref(data_dir: Path) -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", SEARCH_PAGE)

    agent._remember(
        "sig", "invite", {"action": "click", "ref": "e2", "description": "connect"}, perception
    )

    stored = agent_memory.recall_plan("sig", "invite")
    assert stored is not None
    # The ref belonged to a snapshot that no longer exists.
    assert "ref" not in stored
    assert stored["role"] == "button" and stored["name"] == "Connect"


def test_remember_skips_an_element_with_no_durable_name(data_dir: Path) -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", [make_node("e7", "button", "")])

    agent._remember("sig", "invite", {"action": "click", "ref": "e7"}, perception)
    assert agent_memory.recall_plan("sig", "invite") is None


def test_remember_never_caches_terminal_actions(data_dir: Path) -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", SEARCH_PAGE)

    agent._remember("sig", "invite", {"action": "done", "summary": "sent"}, perception)
    assert agent_memory.recall_plan("sig", "invite") is None


def test_rehydrate_points_a_cached_plan_at_the_current_element() -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", SEARCH_PAGE)

    resolved = agent._rehydrate(
        {"action": "click", "role": "button", "name": "Connect"}, perception
    )
    assert resolved is not None
    assert resolved["ref"] == "e2"


def test_rehydrate_declines_when_the_control_is_gone() -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", [make_node("e1", "button", "Follow")])

    # Falling through to a model call is correct; replaying a broken plan is not.
    assert agent._rehydrate({"action": "click", "role": "button", "name": "Connect"}, perception) is None


def test_rehydrate_replays_actions_that_need_no_element() -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", SEARCH_PAGE)

    plan = {"action": "scroll", "direction": "down", "amount": 600}
    assert agent._rehydrate(plan, perception) == plan


def test_rehydrate_declines_an_element_action_with_no_selector() -> None:
    agent = FakeAgent()
    perception = make_perception("https://x/a", SEARCH_PAGE)
    assert agent._rehydrate({"action": "click"}, perception) is None
