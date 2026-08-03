"""Newline-delimited JSON-RPC 2.0 server over stdin/stdout.

Design notes
------------
* stdin is drained by a dedicated daemon thread rather than an asyncio transport:
  asyncio cannot wrap stdio pipes on Windows (the Proactor loop has no
  ``connect_read_pipe`` for them), and a thread works identically everywhere.
* stdout carries protocol traffic only. All logging goes to stderr, which the
  supervisor collects. A stray ``print()`` in a service would corrupt the stream.
* Each request runs as its own task, so a slow AI call never blocks a ping.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
from typing import Any

from ..core.logging import get_logger
from .protocol import (
    ErrorCode,
    Request,
    RpcException,
    error_response,
    notification,
    parse_message,
    success_response,
)
from .registry import MethodRegistry

log = get_logger(__name__)

#: Sentinel pushed onto the queue when stdin reaches EOF.
_EOF = object()


class RpcContext:
    """Handed to any method declaring a ``ctx`` parameter."""

    def __init__(self, server: "RpcServer", request: Request) -> None:
        self._server = server
        self.request = request

    @property
    def method(self) -> str:
        return self.request.method

    @property
    def request_id(self) -> Any:
        return self.request.id

    def notify(self, method: str, params: Any = None) -> None:
        """Push an out-of-band message to the client (progress, stream chunk)."""
        self._server.notify(method, params)

    def progress(self, message: str, percent: float | None = None, **extra: Any) -> None:
        payload: dict[str, Any] = {
            "requestId": self.request.id,
            "method": self.request.method,
            "message": message,
        }
        if percent is not None:
            payload["percent"] = percent
        payload.update(extra)
        self.notify("engine.progress", payload)


class RpcServer:
    def __init__(self, registry: MethodRegistry) -> None:
        self.registry = registry
        self._queue: asyncio.Queue[Any] = asyncio.Queue()
        self._write_lock = threading.Lock()
        self._tasks: set[asyncio.Task[None]] = set()
        self._shutdown = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None

    # ------------------------------------------------------------------ output

    def _write(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":"), default=str)
        with self._write_lock:
            try:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
            except (BrokenPipeError, ValueError):
                # The supervisor is gone; nothing left to serve.
                log.warning("stdout closed while writing; shutting down")
                self.request_shutdown()

    def notify(self, method: str, params: Any = None) -> None:
        self._write(notification(method, params))

    # ------------------------------------------------------------------- input

    def _read_stdin(self) -> None:
        """Blocking reader thread: one JSON message per line."""
        loop = self._loop
        assert loop is not None
        try:
            for line in sys.stdin:
                stripped = line.strip()
                if stripped:
                    loop.call_soon_threadsafe(self._queue.put_nowait, stripped)
        except Exception as error:  # pragma: no cover - defensive
            log.exception("stdin reader failed: %s", error)
        finally:
            loop.call_soon_threadsafe(self._queue.put_nowait, _EOF)

    # ---------------------------------------------------------------- dispatch

    async def _handle_line(self, line: str) -> None:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            log.error("Malformed JSON on stdin: %s", error)
            self._write(
                error_response(None, {"code": ErrorCode.PARSE_ERROR, "message": str(error)})
            )
            return

        try:
            request = parse_message(payload)
        except RpcException as error:
            request_id = payload.get("id") if isinstance(payload, dict) else None
            self._write(error_response(request_id, error.to_error()))
            return

        if request.method == "system.shutdown":
            log.info("Shutdown requested by client")
            if not request.is_notification:
                self._write(success_response(request.id, {"stopping": True}))
            self.request_shutdown()
            return

        task = asyncio.create_task(self._dispatch(request), name=f"rpc:{request.method}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _dispatch(self, request: Request) -> None:
        ctx = RpcContext(self, request)
        try:
            result = await self.registry.invoke(request.method, request.params, ctx)
        except RpcException as error:
            log.warning("%s failed: %s", request.method, error.message)
            if not request.is_notification:
                self._write(error_response(request.id, error.to_error()))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            log.exception("Unhandled error in %s", request.method)
            if not request.is_notification:
                self._write(
                    error_response(
                        request.id,
                        {
                            "code": ErrorCode.INTERNAL_ERROR,
                            "message": f"{type(error).__name__}: {error}",
                        },
                    )
                )
        else:
            if not request.is_notification:
                self._write(success_response(request.id, result))

    # ------------------------------------------------------------------ runtime

    def request_shutdown(self) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self._shutdown.set)

    async def serve(self) -> None:
        self._loop = asyncio.get_running_loop()

        reader = threading.Thread(target=self._read_stdin, name="stdin-reader", daemon=True)
        reader.start()
        log.info("Engine RPC server listening on stdio (%d methods)", len(self.registry.names()))
        self.notify("engine.ready", {"methods": self.registry.names()})

        while not self._shutdown.is_set():
            queue_get = asyncio.create_task(self._queue.get())
            shutdown_wait = asyncio.create_task(self._shutdown.wait())
            done, pending = await asyncio.wait(
                {queue_get, shutdown_wait}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()

            if queue_get not in done:
                break

            item = queue_get.result()
            if item is _EOF:
                log.info("stdin closed; shutting down")
                break

            await self._handle_line(item)

        await self._drain()

    async def _drain(self, timeout: float = 5.0) -> None:
        """Give in-flight requests a moment to answer before the process exits."""
        if not self._tasks:
            return
        log.info("Waiting for %d in-flight request(s)", len(self._tasks))
        done, pending = await asyncio.wait(set(self._tasks), timeout=timeout)
        for task in pending:
            task.cancel()
        if pending:
            log.warning("Cancelled %d request(s) that overran shutdown", len(pending))
