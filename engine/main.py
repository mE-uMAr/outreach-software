"""Engine entrypoint.

Runs as three things without modification:
  * a script          — ``python engine/main.py`` (what the app spawns in dev)
  * a module          — ``python -m engine``
  * a frozen binary   — ``linkedin-outreach-engine.exe`` (PyInstaller, Windows)

Only stderr is safe to write to; stdout is the RPC channel.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Running as a plain script gives no package context, so put the project root on
# sys.path and import everything absolutely from here on.
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from engine.core.config import ENGINE_VERSION, get_settings  # noqa: E402
from engine.core.logging import configure_logging, get_logger  # noqa: E402
from engine.rpc.registry import registry  # noqa: E402
from engine.rpc.server import RpcServer  # noqa: E402


def load_services() -> None:
    """Import every service module so its @method handlers register."""
    from engine.services import system  # noqa: F401
    from engine.services.ai import methods as ai_methods  # noqa: F401
    from engine.services.outreach import methods as outreach_methods  # noqa: F401


async def run() -> int:
    log = get_logger("engine")
    settings = get_settings()
    log.info("LinkedIn Outreach engine v%s starting (data dir: %s)", ENGINE_VERSION, settings.data_dir)

    load_services()
    server = RpcServer(registry)

    try:
        await server.serve()
    except KeyboardInterrupt:
        log.info("Interrupted")
    log.info("Engine stopped")
    return 0


def main() -> None:
    configure_logging()

    if sys.platform == "win32":
        # Proactor is the default on Windows and is what subprocess/pipe support
        # needs; pin it so a future default change cannot break the sidecar.
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    try:
        sys.exit(asyncio.run(run()))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
