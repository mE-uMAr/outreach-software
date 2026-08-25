"""Storage: migrations, campaigns, credentials and the agent's memory."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from engine.core import db, secrets
from engine.store import accounts, agent_memory, settings_store
from engine.store import campaigns as store


def test_migrations_reach_the_expected_version(data_dir: Path) -> None:
    info = db.info()
    assert info["schemaVersion"] == db.SCHEMA_VERSION
    assert {"campaigns", "prospects", "linkedin_accounts", "agent_plans"} <= set(info["tables"])


def test_initialize_is_idempotent(data_dir: Path) -> None:
    again = db.initialize()
    # Nothing left to apply — a second run must not re-run a released migration.
    assert again["applied"] == []
    assert again["schemaVersion"] == db.SCHEMA_VERSION


# ------------------------------------------------------------------- secrets


def test_secrets_round_trip(data_dir: Path) -> None:
    blob = secrets.encrypt('{"cookies": [{"name": "li_at", "value": "s3cret"}]}')
    assert b"s3cret" not in blob, "the plaintext must not survive in the stored blob"
    assert secrets.decrypt(blob) == '{"cookies": [{"name": "li_at", "value": "s3cret"}]}'


def test_secrets_reject_a_tampered_blob(data_dir: Path) -> None:
    blob = bytearray(secrets.encrypt("sensitive"))
    blob[-1] ^= 0xFF
    # DPAPI and the key-file path both refuse; neither returns wrong plaintext.
    with pytest.raises(secrets.SecretError):
        secrets.decrypt(bytes(blob))


def test_try_decrypt_downgrades_failure_to_none(data_dir: Path) -> None:
    assert secrets.try_decrypt(b"v1:kf:garbage") is None
    assert secrets.try_decrypt(None) is None


# ------------------------------------------------------------------ accounts


def test_account_upsert_keeps_one_row_and_round_trips_the_session(data_dir: Path) -> None:
    profile = {
        "memberUrn": "urn:li:member:1",
        "publicId": "alex",
        "fullName": "Alex Rivera",
        "headline": "Founder",
    }
    session = {"cookies": [{"name": "li_at", "value": "abc"}], "origins": []}

    first = accounts.save(profile, session)
    assert first["fullName"] == "Alex Rivera"
    assert "storageState" not in first, "the session must never reach the renderer"

    # The same member signing in again updates rather than duplicating.
    second = accounts.save(profile | {"headline": "CEO"}, session)
    assert second["id"] == first["id"]
    assert second["headline"] == "CEO"

    assert accounts.load_storage_state() == session


def test_account_refresh_without_a_session_keeps_the_stored_one(data_dir: Path) -> None:
    profile = {"memberUrn": "urn:li:member:2", "fullName": "Sam"}
    session = {"cookies": [{"name": "li_at", "value": "keep-me"}]}
    accounts.save(profile, session)

    accounts.save(profile | {"headline": "Updated"}, None)
    assert accounts.load_storage_state() == session


def test_expired_account_keeps_the_profile_but_drops_the_session(data_dir: Path) -> None:
    accounts.save({"memberUrn": "urn:li:member:3", "fullName": "Kim"}, {"cookies": []})
    accounts.mark_expired("cookie rejected")

    account = accounts.get_active()
    assert account is not None
    assert account["status"] == "expired"
    assert account["fullName"] == "Kim"
    assert accounts.load_storage_state() is None


# ----------------------------------------------------------------- campaigns


def test_campaign_lifecycle(data_dir: Path) -> None:
    campaign = store.create(
        "Dubai CEOs", account_id=None, target_prospects=500, daily_target=20
    )
    assert campaign["status"] == "draft"
    assert campaign["startDate"] is None

    running = store.set_status(campaign["id"], "running")
    assert running is not None
    assert running["status"] == "running"
    # Starting is what dates a campaign.
    assert running["startDate"] == date.today().isoformat()

    paused = store.set_status(campaign["id"], "paused")
    assert paused is not None
    resumed = store.set_status(campaign["id"], "running")
    assert resumed is not None
    # Resuming must not move the original start date.
    assert resumed["startDate"] == running["startDate"]

    assert store.delete(campaign["id"]) is True
    assert store.get(campaign["id"]) is None


def test_campaign_status_is_validated(data_dir: Path) -> None:
    campaign = store.create("X", account_id=None)
    with pytest.raises(ValueError):
        store.set_status(campaign["id"], "exploded")


def test_update_rejects_unknown_fields(data_dir: Path) -> None:
    campaign = store.create("X", account_id=None)
    with pytest.raises(ValueError):
        store.update(campaign["id"], sql_injection="; DROP TABLE campaigns;--")


def test_search_escapes_like_wildcards(data_dir: Path) -> None:
    store.create("Growth 100%", account_id=None)
    store.create("Growth 200", account_id=None)

    # An unescaped % would match both; escaped, it matches only the literal name.
    assert store.list_page(search="100%")["total"] == 1
    assert store.list_page(search="Growth")["total"] == 2


def test_pagination_and_sorting(data_dir: Path) -> None:
    for index in range(7):
        store.create(f"Campaign {index}", account_id=None, target_prospects=index * 10)

    page = store.list_page(page=2, page_size=5, sort="prospects")
    assert page["total"] == 7
    assert len(page["items"]) == 2
    assert page["items"][0]["targetProspects"] >= page["items"][1]["targetProspects"]


def test_prospects_are_deduplicated_per_campaign(data_dir: Path) -> None:
    campaign = store.create("X", account_id=None)
    people = [
        {"fullName": "A", "profileUrl": "https://www.linkedin.com/in/a"},
        {"fullName": "B", "profileUrl": "https://www.linkedin.com/in/b"},
        {"fullName": "A again", "profileUrl": "https://www.linkedin.com/in/a"},
        {"fullName": "No URL"},
    ]

    assert store.add_prospects(campaign["id"], people) == 2
    # Re-importing the same search must queue nobody twice.
    assert store.add_prospects(campaign["id"], people) == 0
    assert len(store.list_prospects(campaign["id"])) == 2


def test_recount_sent_derives_from_the_prospect_rows(data_dir: Path) -> None:
    campaign = store.create("X", account_id=None, target_prospects=10)
    store.add_prospects(
        campaign["id"],
        [{"fullName": f"P{i}", "profileUrl": f"https://www.linkedin.com/in/p{i}"} for i in range(3)],
    )

    prospects = store.list_prospects(campaign["id"])
    store.mark_prospect(prospects[0]["id"], "invited")
    store.mark_prospect(prospects[1]["id"], "accepted")

    assert store.recount_sent(campaign["id"]) == 2
    refreshed = store.get(campaign["id"])
    assert refreshed is not None
    assert refreshed["connectionsSent"] == 2


def test_deleting_a_campaign_takes_its_prospects(data_dir: Path) -> None:
    campaign = store.create("X", account_id=None)
    store.add_prospects(campaign["id"], [{"fullName": "A", "profileUrl": "https://x/in/a"}])

    store.delete(campaign["id"])
    assert store.list_prospects(campaign["id"]) == []


def test_stats_count_only_what_happened(data_dir: Path) -> None:
    campaign = store.create("X", account_id=None, target_prospects=100)
    store.set_status(campaign["id"], "running")
    store.add_prospects(
        campaign["id"],
        [{"fullName": f"P{i}", "profileUrl": f"https://x/in/p{i}"} for i in range(4)],
    )

    prospects = store.list_prospects(campaign["id"])
    # The real lifecycle: everyone is invited before they can accept, and each
    # transition stamps its own column.
    store.mark_prospect(prospects[0]["id"], "invited")
    store.mark_prospect(prospects[1]["id"], "invited")
    store.mark_prospect(prospects[1]["id"], "accepted")

    stats = store.stats()
    assert stats["totalCampaigns"] == 1
    assert stats["activeCampaigns"] == 1
    assert stats["totalProspects"] == 100
    assert stats["connectionsSentToday"] == 2
    # Accepted with no reply yet is exactly what a pending follow-up is.
    assert stats["pendingFollowUps"] == 1


def test_working_day_end_counts_only_working_days() -> None:
    start = date(2026, 1, 5)  # a Monday
    # 10 working days at 5 a week is two calendar weeks, not ten days.
    assert store.working_day_end(start, 10, 5) == "2026-01-19"
    assert store.working_day_end(start, 0, 5) == start.isoformat()
    assert store.working_day_end(start, 3, 7) == "2026-01-08"


# ------------------------------------------------------------------ settings


def test_settings_default_and_round_trip(data_dir: Path) -> None:
    defaults = settings_store.get_automation()
    assert defaults["ai"]["provider"] == "claude"
    assert len(defaults["schedule"]) == 7
    assert len(defaults["templates"]) == 4

    saved = settings_store.save_automation(
        {"limits": {"connectionRequests": 12}, "ai": {"model": "sonnet"}}
    )
    # A partial save keeps everything it did not mention.
    assert saved["limits"]["connectionRequests"] == 12
    assert saved["limits"]["postLikes"] == defaults["limits"]["postLikes"]
    assert saved["ai"]["provider"] == "claude"
    assert saved["ai"]["model"] == "sonnet"
    assert settings_store.get_automation()["limits"]["connectionRequests"] == 12


def test_saved_lists_replace_rather_than_merge(data_dir: Path) -> None:
    trimmed = [
        {"key": "mon", "short": "Mon", "full": "Monday", "enabled": True, "action": "send", "dailyLimit": 5}
    ]
    saved = settings_store.save_automation({"schedule": trimmed})
    # A per-index merge would resurrect the six days the user removed.
    assert len(saved["schedule"]) == 1


def test_daily_limit_takes_the_tighter_of_the_two_controls(data_dir: Path) -> None:
    settings = settings_store.get_automation()
    settings["limits"]["connectionRequests"] = 8
    assert settings_store.daily_limit_for(settings) == 8

    settings["limits"]["connectionRequests"] = 100
    for day in settings["schedule"]:
        day["dailyLimit"] = 15
    assert settings_store.daily_limit_for(settings) == 15


def test_working_days_per_week_counts_active_days(data_dir: Path) -> None:
    settings = settings_store.get_automation()
    assert settings_store.working_days_per_week(settings) == 5

    for day in settings["schedule"]:
        day["enabled"] = False
    # Never zero: it is a divisor in the pacing maths.
    assert settings_store.working_days_per_week(settings) == 1


# -------------------------------------------------------------- agent memory


def test_plan_cache_recall_and_eviction(data_dir: Path) -> None:
    plan = {"action": "click", "role": "button", "name": "Connect"}
    agent_memory.remember_plan("sig", "invite", plan, "haiku")

    assert agent_memory.recall_plan("sig", "invite") == plan
    # A different goal on the same page is a different decision.
    assert agent_memory.recall_plan("sig", "other-goal") is None

    for _ in range(agent_memory.MAX_PLAN_FAILURES):
        agent_memory.record_plan_failure("sig")
    assert agent_memory.recall_plan("sig", "invite") is None


def test_remembering_again_clears_prior_failures(data_dir: Path) -> None:
    agent_memory.remember_plan("sig", "invite", {"action": "click"}, None)
    agent_memory.record_plan_failure("sig")
    agent_memory.remember_plan("sig", "invite", {"action": "click", "ref": "e2"}, None)

    assert agent_memory.recall_plan("sig", "invite") is not None


def test_usage_summary_reports_spend_and_cache_effect(data_dir: Path) -> None:
    agent_memory.record_usage("browser.decide", model="haiku", input_tokens=900, cost_usd=0.001)
    agent_memory.record_usage(
        "campaign.plan", model="sonnet", input_tokens=1200, cost_usd=0.02, had_screenshot=True
    )
    agent_memory.remember_plan("sig", "invite", {"action": "click"}, None)
    agent_memory.recall_plan("sig", "invite")

    summary = agent_memory.usage_summary()
    assert summary["calls"] == 2
    assert summary["costUsd"] == pytest.approx(0.021)
    assert summary["cacheHits"] == 1
    assert summary["screenshotRate"] == pytest.approx(0.5)
    assert summary["byPurpose"][0]["purpose"] == "campaign.plan"
