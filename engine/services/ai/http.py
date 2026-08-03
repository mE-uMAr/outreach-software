"""Lazy httpx access.

HTTP-backed providers import httpx on first use rather than at module load, so
the engine still starts (and the offline provider still works) in an environment
where the dependency was never installed. Missing dependencies surface as a
provider being unavailable instead of a dead sidecar.
"""

from __future__ import annotations

from typing import Any

from ...rpc.protocol import ErrorCode, RpcException

_MISSING_MESSAGE = "The httpx package is not installed; run `pip install -r requirements.txt`"


def httpx_available() -> bool:
    try:
        import httpx  # noqa: F401
    except ImportError:
        return False
    return True


def require_httpx() -> Any:
    """Return the httpx module, or raise an RPC-visible error if it is absent."""
    try:
        import httpx
    except ImportError as error:
        raise RpcException(_MISSING_MESSAGE, ErrorCode.ENGINE_ERROR) from error
    return httpx
