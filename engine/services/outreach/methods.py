"""outreach.* methods.

Empty by design — this is the seam for outreach features. Register handlers here
as they are built:

    from ...rpc.registry import method

    @method("outreach.<name>")
    def handler(...): ...

The `outreach.` namespace is already allow-listed for the renderer in
src/main/ipc.ts, so anything registered here is callable from the UI immediately.
"""

from __future__ import annotations
