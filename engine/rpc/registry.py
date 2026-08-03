"""Method registry.

Services register handlers with @method("namespace.name"). Handlers may be sync
or async and receive keyword arguments from the request's `params` object, plus
a `ctx` keyword when they declare one.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .protocol import InvalidParams, MethodNotFound

Handler = Callable[..., Any]


@dataclass(slots=True)
class RegisteredMethod:
    name: str
    handler: Handler
    is_async: bool
    wants_ctx: bool
    description: str


class MethodRegistry:
    def __init__(self) -> None:
        self._methods: dict[str, RegisteredMethod] = {}

    def method(self, name: str) -> Callable[[Handler], Handler]:
        def decorator(handler: Handler) -> Handler:
            if name in self._methods:
                raise RuntimeError(f'Method "{name}" is already registered')

            signature = inspect.signature(handler)
            self._methods[name] = RegisteredMethod(
                name=name,
                handler=handler,
                is_async=inspect.iscoroutinefunction(handler),
                wants_ctx="ctx" in signature.parameters,
                description=(inspect.getdoc(handler) or "").split("\n")[0],
            )
            return handler

        return decorator

    def get(self, name: str) -> RegisteredMethod:
        try:
            return self._methods[name]
        except KeyError:
            raise MethodNotFound(name) from None

    def names(self) -> list[str]:
        return sorted(self._methods)

    def describe(self) -> list[dict[str, str]]:
        return [
            {"name": entry.name, "description": entry.description}
            for entry in sorted(self._methods.values(), key=lambda item: item.name)
        ]

    async def invoke(self, name: str, params: dict[str, Any], ctx: Any) -> Any:
        entry = self.get(name)
        kwargs = dict(params)
        if entry.wants_ctx:
            kwargs["ctx"] = ctx

        try:
            bound = inspect.signature(entry.handler).bind(**kwargs)
        except TypeError as error:
            raise InvalidParams(f'Invalid params for "{name}": {error}') from error

        if entry.is_async:
            return await entry.handler(*bound.args, **bound.kwargs)

        # Sync handlers go to a worker thread so a blocking call (HTTP, sqlite,
        # scraping) can never stall the stdio loop.
        return await asyncio.to_thread(entry.handler, *bound.args, **bound.kwargs)


#: Process-wide registry; services import this and decorate their handlers.
registry = MethodRegistry()
method = registry.method
