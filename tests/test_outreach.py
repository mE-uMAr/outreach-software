"""Message drafting, search classification and the runner's pacing.

The AI is stubbed here on purpose: what needs testing is the logic wrapped
*around* the model — the substitution that avoids calling it, the limits enforced
after it answers, and the pacing that decides when it is called at all.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest

from engine.rpc.protocol import RpcException
from engine.services.linkedin import search
from engine.services.outreach import drafting, runner
from engine.store import settings_store

PROSPECT = {
    "fullName": "Alex Rivera",
    "headline": "Head of Growth at Northwind",
    "company": "Northwind",
    "location": "Dubai",
}


# ------------------------------------------------------------------ drafting


def test_fill_substitutes_what_is_known() -> None:
    filled = drafting.fill(
        "Hi {{firstName}}, I follow {{company}} in {{location}}.", PROSPECT, None
    )
    assert filled == "Hi Alex, I follow Northwind in Dubai."


def test_fill_leaves_unknown_placeholders_alone() -> None:
    filled = drafting.fill("Hi {{firstName}} — {{industry}}?", PROSPECT, None)
    # Left intact so `_unresolved` can spot it and hand the sentence to Claude.
    assert "{{industry}}" in filled


def test_fill_handles_a_single_word_name() -> None:
    assert drafting.fill("Hi {{firstName}}", {"fullName": "Cher"}, None) == "Hi Cher"


def test_fill_tolerates_a_missing_name() -> None:
    assert drafting.fill("Hi {{firstName}}", {}, None) == "Hi "


def test_truncate_cuts_on_a_word_boundary() -> None:
    assert drafting.truncate("hello world", 50) == "hello world"

    cut = drafting.truncate("the quick brown fox jumps", 15)
    assert len(cut) <= 15
    assert not cut.rstrip("…").endswith(" ")


async def test_a_complete_template_never_calls_the_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """Substitution alone is correct, instant and free.

    On a 500-prospect campaign this is 500 requests not made.
    """
    called = False

    async def explode(*args: Any, **kwargs: Any) -> dict[str, Any]:
        nonlocal called
        called = True
        raise AssertionError("the model must not be called for a complete template")

    monkeypatch.setattr(drafting.reason, "ask_json", explode)

    template = {"body": "Hi {{firstName}}, good to connect.", "maxChars": 300}
    assert await drafting.personalise(template, PROSPECT) == "Hi Alex, good to connect."
    assert not called


async def test_an_unresolved_placeholder_reaches_the_model(monkeypatch: pytest.MonkeyPatch) -> None:
    async def answer(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"message": "Hi Alex, saw your work on growth."}

    monkeypatch.setattr(drafting.reason, "ask_json", answer)

    template = {"body": "Hi {{firstName}}, saw {{industry}}.", "maxChars": 300}
    assert await drafting.personalise(template, PROSPECT) == "Hi Alex, saw your work on growth."


async def test_an_overlong_reply_is_cut_to_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """LinkedIn rejects a note over 300 characters, so it is measured, not trusted."""

    async def answer(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"message": "word " * 200}

    monkeypatch.setattr(drafting.reason, "ask_json", answer)

    note = await drafting.connection_note(
        {"body": "Hi {{firstName}} {{unknown}}", "maxChars": 300}, PROSPECT
    )
    assert len(note) <= 300


async def test_a_connection_note_is_capped_at_300_even_if_the_template_asks_for_more(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def answer(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"message": "x" * 900}

    monkeypatch.setattr(drafting.reason, "ask_json", answer)

    note = await drafting.connection_note(
        {"body": "Hi {{firstName}} {{unknown}}", "maxChars": 2000}, PROSPECT
    )
    assert len(note) <= 300


async def test_an_empty_reply_falls_back_to_the_filled_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def answer(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"message": "   "}

    monkeypatch.setattr(drafting.reason, "ask_json", answer)

    template = {"body": "Hi {{firstName}}, about {{unknown}}.", "maxChars": 300}
    result = await drafting.personalise(template, PROSPECT)
    # A less tailored message beats no message.
    assert result.startswith("Hi Alex")


async def test_an_empty_template_produces_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    assert await drafting.personalise({"body": "   ", "maxChars": 300}, PROSPECT) == ""


# -------------------------------------------------------------- search URLs


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.linkedin.com/sales/search/people?keywords=ceo", "sales-navigator"),
        ("https://linkedin.com/sales/search/people", "sales-navigator"),
        ("https://www.linkedin.com/search/results/people/?keywords=cto", "search"),
    ],
)
def test_recognised_search_urls(url: str, expected: str) -> None:
    assert search.classify_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/search",
        "https://www.linkedin.com/feed/",
        "https://www.linkedin.com/in/alex",
        "not a url",
        "",
    ],
)
def test_rejected_search_urls(url: str) -> None:
    with pytest.raises(RpcException):
        search.classify_url(url)


def test_filters_are_read_from_the_url() -> None:
    filters = search._filters_from_url(
        "https://www.linkedin.com/sales/search/people?keywords=head%20of%20growth&industry=tech"
    )
    assert filters["keywords"] == "head of growth"
    assert filters["industry"] == "tech"


def test_fallback_name_comes_from_the_search_keywords() -> None:
    name = search._name_from_url(
        "https://www.linkedin.com/sales/search/people?keywords=head%20of%20growth%20dubai"
    )
    assert name == "Head Of Growth Dubai"


def test_fallback_name_survives_a_url_with_no_keywords() -> None:
    name = search._name_from_url("https://www.linkedin.com/sales/search/people")
    assert date.today().isoformat() in name


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Showing 1-25 of 2,431 results", 2431),
        ("About 843 results", 843),
        ("1,204 results", 1204),
        ("No idea", None),
    ],
)
def test_result_count_patterns(text: str, expected: int | None) -> None:
    found = None
    for pattern in search._COUNT_PATTERNS:
        match = pattern.search(text)
        if match:
            digits = match.group(1).replace(",", "").replace(".", "")
            found = int(digits) if digits.isdigit() else None
            break
    assert found == expected


# -------------------------------------------------------------------- runner


def test_delay_is_randomised_and_never_too_fast() -> None:
    delays = {runner._delay() for _ in range(50)}
    # A fixed interval is what makes automation obvious to LinkedIn.
    assert len(delays) > 40
    assert all(delay >= 20 for delay in delays)
    assert all(delay <= runner.BASE_DELAY_SECONDS * 2 for delay in delays)


def test_today_window_is_none_on_a_day_the_schedule_is_off(data_dir: Path) -> None:
    settings = settings_store.get_automation()
    for day in settings["schedule"]:
        day["enabled"] = False
    assert runner._today_window(settings) is None


def test_today_window_is_none_when_the_day_does_no_work(data_dir: Path) -> None:
    settings = settings_store.get_automation()
    for day in settings["schedule"]:
        day["enabled"] = True
        day["action"] = "none"
    assert runner._today_window(settings) is None


def test_today_window_is_found_when_the_day_is_active(data_dir: Path) -> None:
    settings = settings_store.get_automation()
    for day in settings["schedule"]:
        day["enabled"] = True
        day["action"] = "send"
        day["dailyLimit"] = 17

    window = runner._today_window(settings)
    assert window is not None
    assert window["dailyLimit"] == 17
