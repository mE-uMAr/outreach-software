# LinkedIn Outreach

Electron desktop app with a Python sidecar engine. The UI never does real work —
it sends JSON-RPC calls to the engine, which owns outreach logic and AI provider
access.

The transport, process supervision, provider abstraction and Windows build
pipeline are in place and verified. The UI is built out against **mock data** —
the engine's `outreach.*` namespace is still empty, and swapping mocks for real
calls happens in one file (see [Frontend state](#frontend-state)).

## Architecture

```
┌──────────────────────── Electron ────────────────────────┐
│  renderer (React)                                        │
│      │  window.outreach.engine.call(method, params)      │
│      ▼                                                   │
│  preload  ──contextBridge──▶  main process                │
│                                   │                       │
│                          EngineSupervisor                 │
│                    (spawn · handshake · restart)          │
└───────────────────────────────────│──────────────────────┘
                                    │ JSON-RPC 2.0
                                    │ newline-delimited, over stdio
┌───────────────────────────────────▼──────────────────────┐
│  Python engine                                            │
│      RpcServer ──▶ MethodRegistry ──▶ services            │
│                                       ├── system.*        │
│                                       ├── ai.*            │
│                                       └── outreach.*      │
└──────────────────────────────────────────────────────────┘
```

**stdout is the protocol channel.** All engine logging goes to stderr, which the
supervisor captures. A stray `print()` in a service corrupts the stream.

## Layout

| Path | Purpose |
| --- | --- |
| `src/main/` | App lifecycle, engine supervisor, IPC handlers |
| `src/main/engine/locate.ts` | Resolves the engine binary (frozen vs. source) |
| `src/main/engine/supervisor.ts` | Spawn, handshake, crash recovery, shutdown |
| `src/main/rpc-client.ts` | JSON-RPC client over the child process' stdio |
| `src/preload/` | The only API exposed to the renderer |
| `src/renderer/` | React UI (Tailwind + lucide icons) |
| `src/renderer/src/data/api.ts` | **Mock data seam** — swap these bodies for engine calls |
| `src/renderer/src/pages/` | Campaigns dashboard and Automation Settings |
| `src/renderer/src/components/campaigns/` | Table, stats, create-campaign flow |
| `src/renderer/src/components/settings/` | Schedule, limits, follow-ups, templates, sheets, AI |
| `src/shared/rpc.ts` | Wire contract shared by both TypeScript sides |
| `engine/rpc/` | Protocol, method registry, stdio server |
| `engine/services/` | RPC-exposed methods, grouped by namespace |
| `engine/services/ai/` | Provider abstraction + implementations |
| `engine/core/db.py` | SQLite connection + versioned migrations |
| `.github/workflows/` | Windows build pipeline |

## Prerequisites

- Node.js 20+
- Python 3.11+

## Running it

One command sets everything up and starts the app:

```bash
npm run up           # or: ./scripts/up.sh
```

It installs Node dependencies, downloads the Electron binary if the postinstall
was skipped, creates `.venv`, installs the engine's dependencies, smoke-tests the
engine over stdio, then launches Electron with HMR.

```bash
npm run up -- --setup-only   # prepare dependencies without launching
npm run up -- --clean        # wipe node_modules and .venv first
npm run dev                  # skip the checks, start straight away
```

The app finds the interpreter in this order: `LINKEDIN_OUTREACH_PYTHON`, then
`.venv/`, then `python`/`python3` on PATH.

The engine can also be driven directly, which is the fastest way to test a new
method:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"system.methods"}' | python engine/main.py
```

## Checks

```bash
npm run typecheck    # main, preload, renderer
pytest -q            # engine
ruff check engine    # engine lint
```

## Frontend state

The UI is built against mock data. Every screen reads through
`src/renderer/src/data/api.ts`, whose functions are async and already shaped like
the engine calls that will replace them:

```ts
export async function listCampaigns(query: CampaignQuery): Promise<CampaignPage> {
  return engineCall<CampaignPage>('outreach.listCampaigns', query)
}
```

No component imports fixtures directly, so swapping in real RPC is a change of
function bodies only. `analyzeSalesNavigatorUrl` already takes a progress
callback so the create-campaign modal will map straight onto `engine.progress`
notifications.

Screens implemented so far:

- **Campaigns** — stats, filterable/sortable table, pagination, row actions
- **Create Campaign** — three-phase modal: URL input → AI analysis → approve
- **Automation Settings** — weekly schedule, activity limits, follow-up rules,
  message templates, Google Sheets, AI connection

## Adding an RPC method

1. Register a handler in the relevant service module:

   ```python
   from ...rpc.registry import method

   @method("outreach.listProspects")
   async def list_prospects(limit: int = 50) -> list[dict]:
       """One-line docstring — shown in system.methods."""
       ...
   ```

   Params arrive as keyword arguments. Sync handlers run in a worker thread, so
   blocking I/O is safe. Declare a `ctx` parameter to get `ctx.notify(...)` and
   `ctx.progress(...)` for pushing events to the UI mid-call.

2. Call it from the renderer:

   ```ts
   const prospects = await call<Prospect[]>('outreach.listProspects', { limit: 20 })
   ```

Only the `system.`, `ai.` and `outreach.` namespaces are reachable from the
renderer; the allow-list lives in `src/main/ipc.ts`.

## Adding an AI provider

Subclass `AIProvider` in `engine/services/ai/providers/`, implement `complete()`
(and `stream()` for real token streaming), then add the class to
`_PROVIDER_CLASSES` in `engine/services/ai/registry.py`. Nothing else changes.

The `echo` provider is the default and needs no API key or network, so the full
pipeline is testable offline. Keys come from `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY`, or from `config.json` in the user data directory.

## Storage

SQLite, in the app's user-data directory (`%APPDATA%/linkedin-outreach` on
Windows). `engine/core/db.py` owns the connection and applies versioned
migrations at startup via `PRAGMA user_version`.

`MIGRATIONS` is currently **empty** — no tables yet. Add one per feature and
never edit a released migration:

```python
MIGRATIONS: tuple[Migration, ...] = (
    Migration(version=1, name="campaigns", sql="CREATE TABLE campaigns (...);"),
)
```

Inspect the live database from the UI or over RPC with `system.dbInfo` (path,
schema version, SQLite version, per-table row counts).

## Distribution

The installed app is self-contained — **the target machine needs neither Python
nor Node.js**:

| Dependency | How it ships |
| --- | --- |
| Chromium + Node runtime | inside Electron |
| CPython + engine deps (httpx) | frozen by PyInstaller into `resources/engine/` |
| SQLite | `_sqlite3` + `sqlite3.dll`, bundled with the frozen engine |
| Database file | created on first run in the user-data directory |

A packaged build runs the frozen engine and *only* that — there is deliberately
no fallback to a system interpreter, so a broken package reports itself instead
of failing later with a confusing "python not found". CI enforces this: it greps
the bundle for the SQLite natives and drives the real `.exe` from a temp
directory, asserting both `system.info` and `system.dbInfo` succeed.

## Windows build

CI (`.github/workflows/build-windows.yml`) runs on `windows-latest` and:

1. lints, tests and freezes the engine with PyInstaller
2. smoke-tests the frozen `.exe` with a real JSON-RPC request
3. builds the Electron app and packages NSIS + portable installers
4. uploads them as artifacts; tags matching `v*` also create a draft release

Locally on Windows:

```bash
npm run engine:freeze
npm run build:win
```

Artifacts land in `release/`. The frozen engine is shipped as
`resources/engine/linkedin-outreach-engine.exe`.

> No code signing certificate is configured, so SmartScreen will warn on first
> run. Add `win.certificateFile`/`certificatePassword` in `electron-builder.yml`
> when one is available.
