"""Smoke tests for the RPC layer.

These cover the plumbing the whole app depends on: message parsing, dispatch,
error mapping and the stdio round trip against the real entrypoint.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from engine.rpc.protocol import ErrorCode, RpcException, parse_message
from engine.rpc.registry import MethodRegistry

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def test_parse_message_accepts_a_request() -> None:
    request = parse_message({"jsonrpc": "2.0", "id": 7, "method": "system.ping", "params": {"a": 1}})
    assert request.method == "system.ping"
    assert request.params == {"a": 1}
    assert request.id == 7
    assert not request.is_notification


def test_parse_message_treats_missing_id_as_notification() -> None:
    request = parse_message({"jsonrpc": "2.0", "method": "system.shutdown"})
    assert request.is_notification


@pytest.mark.parametrize(
    "payload",
    [
        {"id": 1, "method": "system.ping"},  # missing jsonrpc
        {"jsonrpc": "1.0", "id": 1, "method": "system.ping"},  # wrong version
        {"jsonrpc": "2.0", "id": 1},  # missing method
        {"jsonrpc": "2.0", "id": 1, "method": "x", "params": [1, 2]},  # positional params
    ],
)
def test_parse_message_rejects_invalid_payloads(payload: dict) -> None:
    with pytest.raises(RpcException):
        parse_message(payload)


async def test_registry_invokes_sync_and_async_handlers() -> None:
    registry = MethodRegistry()

    @registry.method("test.sync")
    def sync_handler(value: int) -> int:
        return value * 2

    @registry.method("test.async")
    async def async_handler(value: int) -> int:
        return value + 1

    assert await registry.invoke("test.sync", {"value": 21}, ctx=None) == 42
    assert await registry.invoke("test.async", {"value": 41}, ctx=None) == 42


async def test_registry_rejects_unknown_method_and_bad_params() -> None:
    registry = MethodRegistry()

    @registry.method("test.one")
    def handler(value: int) -> int:
        return value

    with pytest.raises(RpcException) as unknown:
        await registry.invoke("test.missing", {}, ctx=None)
    assert unknown.value.code == ErrorCode.METHOD_NOT_FOUND

    with pytest.raises(RpcException) as bad_params:
        await registry.invoke("test.one", {"wrong": 1}, ctx=None)
    assert bad_params.value.code == ErrorCode.INVALID_PARAMS


def test_engine_answers_over_stdio() -> None:
    """Start the real entrypoint and complete a request/response round trip."""
    requests = "\n".join(
        [
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "system.info"}),
            json.dumps(
                {"jsonrpc": "2.0", "id": 2, "method": "system.ping", "params": {"payload": {"n": 5}}}
            ),
            json.dumps({"jsonrpc": "2.0", "id": 3, "method": "does.not.exist"}),
        ]
    )

    process = subprocess.run(
        [sys.executable, "-u", str(PROJECT_ROOT / "engine" / "main.py")],
        input=requests + "\n",
        capture_output=True,
        text=True,
        timeout=60,
        cwd=PROJECT_ROOT,
    )

    messages = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
    by_id = {message["id"]: message for message in messages if message.get("id") is not None}

    assert by_id[1]["result"]["version"]
    assert by_id[2]["result"]["pong"] is True
    assert by_id[2]["result"]["payload"] == {"n": 5}
    assert by_id[3]["error"]["code"] == ErrorCode.METHOD_NOT_FOUND

    # Anything the engine says outside a response must be a notification, never
    # stray output — stdout is the protocol channel.
    assert all("jsonrpc" in message for message in messages)
