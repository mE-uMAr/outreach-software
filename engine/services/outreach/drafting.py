"""Writing the message that actually gets sent.

The operator's template is the intent and the guardrail; Claude personalises
inside it. Two things are enforced here rather than trusted to the model:

* **The character limit.** LinkedIn rejects a connection note over 300
  characters outright, so the result is measured and cut rather than hoped for.
* **The placeholders.** A template with no {{tokens}} in it needs no model call
  at all — substitution alone is correct, instant and free.
"""

from __future__ import annotations

import re
from typing import Any

from ...core.logging import get_logger
from ..ai import reason

log = get_logger(__name__)

_PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")

DRAFT_SYSTEM = """You personalise short LinkedIn messages for a real \
salesperson's account.

Rules:
- Keep the operator's template as the intent. You are adapting it, not \
replacing it.
- Sound like a person. No "I hope this finds you well", no marketing voice.
- Use only the prospect details you are given. Never invent a fact about them.
- Stay within the character limit; it is enforced by LinkedIn, not by preference.
- No emoji unless the template itself uses them.

Reply with a single JSON object: {"message": "..."}"""


def fill(template: str, prospect: dict[str, Any], campaign: dict[str, Any] | None) -> str:
    """Substitute {{placeholders}} from what is actually known."""
    first_name = (prospect.get("fullName") or "").strip().split(" ")[0]
    values = {
        "firstName": first_name,
        "fullName": prospect.get("fullName") or "",
        "headline": prospect.get("headline") or "",
        "company": prospect.get("company") or "",
        "location": prospect.get("location") or "",
        "campaign": (campaign or {}).get("name") or "",
    }

    def replace(match: re.Match[str]) -> str:
        return values.get(match.group(1), match.group(0))

    return _PLACEHOLDER.sub(replace, template)


def _unresolved(text: str) -> list[str]:
    """Placeholders left over because nothing was known to fill them."""
    return _PLACEHOLDER.findall(text)


def truncate(message: str, limit: int) -> str:
    """Cut to the limit on a word boundary."""
    if len(message) <= limit:
        return message
    return message[: limit - 1].rsplit(" ", 1)[0] + "…"


async def personalise(
    template: dict[str, Any],
    prospect: dict[str, Any],
    campaign: dict[str, Any] | None = None,
) -> str:
    """Turn a template into the message for one prospect."""
    body = str(template.get("body") or "").strip()
    if not body:
        return ""

    limit = int(template.get("maxChars") or 2000)
    filled = fill(body, prospect, campaign)

    # A template that is already complete after substitution needs no model call.
    # On a 500-prospect campaign that is 500 requests not made.
    if not _PLACEHOLDER.search(body) or not _unresolved(filled):
        if len(filled) <= limit:
            return filled

    prompt = f"""Operator's template:
"{body}"

After filling in what is known:
"{filled}"

Character limit: {limit}

Prospect:
- Name: {prospect.get('fullName') or 'unknown'}
- Headline: {prospect.get('headline') or 'unknown'}
- Company: {prospect.get('company') or 'unknown'}
- Location: {prospect.get('location') or 'unknown'}
{f"- Campaign: {campaign['name']}" if campaign else ""}

Write the final message. Where a detail is unknown, rewrite the sentence so it
reads naturally without it rather than leaving a gap or guessing."""

    answer = await reason.ask_json(
        prompt,
        system=DRAFT_SYSTEM,
        tier=reason.REASONING,
        purpose="outreach.draft",
        max_tokens=400,
        temperature=0.7,
    )

    message = str(answer.get("message") or "").strip()
    if not message:
        # The model gave nothing usable; the substituted template is still a
        # correct message, just a less tailored one.
        log.warning("Empty draft returned; using the filled template")
        message = filled

    return truncate(message, limit)


async def connection_note(
    template: dict[str, Any],
    prospect: dict[str, Any],
    campaign: dict[str, Any] | None = None,
) -> str:
    """A connection note, hard-capped at LinkedIn's 300 characters."""
    note = await personalise(template, prospect, campaign)
    return truncate(note, min(300, int(template.get("maxChars") or 300)))
