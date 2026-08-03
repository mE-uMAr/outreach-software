"""JSON-RPC 2.0 message shapes.

Mirrors src/shared/rpc.ts — keep the two in sync when changing error codes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

JSONRPC_VERSION = "2.0"

RpcId = int | str


class ErrorCode:
    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    #: Application-level failure raised by a service.
    ENGINE_ERROR = -32000
    TIMEOUT = -32001
    UNAVAILABLE = -32002


class RpcException(Exception):
    """Raised by services; serialized into a JSON-RPC error object."""

    def __init__(self, message: str, code: int = ErrorCode.ENGINE_ERROR, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_error(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            error["data"] = self.data
        return error


class InvalidParams(RpcException):
    def __init__(self, message: str, data: Any = None) -> None:
        super().__init__(message, ErrorCode.INVALID_PARAMS, data)


class MethodNotFound(RpcException):
    def __init__(self, method: str) -> None:
        super().__init__(f'Unknown method "{method}"', ErrorCode.METHOD_NOT_FOUND)


@dataclass(slots=True)
class Request:
    """An inbound call. `id is None` means it is a notification."""

    method: str
    params: dict[str, Any] = field(default_factory=dict)
    id: RpcId | None = None

    @property
    def is_notification(self) -> bool:
        return self.id is None


def parse_message(payload: Any) -> Request:
    """Validate a decoded JSON object into a Request."""
    if not isinstance(payload, dict):
        raise RpcException("Request must be a JSON object", ErrorCode.INVALID_REQUEST)

    if payload.get("jsonrpc") != JSONRPC_VERSION:
        raise RpcException(
            f'Unsupported jsonrpc version: {payload.get("jsonrpc")!r}', ErrorCode.INVALID_REQUEST
        )

    method = payload.get("method")
    if not isinstance(method, str) or not method:
        raise RpcException("Request is missing a method name", ErrorCode.INVALID_REQUEST)

    raw_params = payload.get("params")
    if raw_params is None:
        params: dict[str, Any] = {}
    elif isinstance(raw_params, dict):
        params = raw_params
    else:
        # Positional params are deliberately unsupported: every engine method takes
        # a keyword payload, which keeps the TS and Python sides symmetric.
        raise InvalidParams("params must be an object (positional params unsupported)")

    request_id = payload.get("id")
    if request_id is not None and not isinstance(request_id, int | str):
        raise RpcException("id must be a number, string or null", ErrorCode.INVALID_REQUEST)

    return Request(method=method, params=params, id=request_id)


def success_response(request_id: RpcId, result: Any) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC_VERSION, "id": request_id, "result": result}


def error_response(request_id: RpcId | None, error: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": JSONRPC_VERSION, "id": request_id, "error": error}


def notification(method: str, params: Any = None) -> dict[str, Any]:
    message: dict[str, Any] = {"jsonrpc": JSONRPC_VERSION, "method": method}
    if params is not None:
        message["params"] = params
    return message
