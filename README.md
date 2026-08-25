# LinkedIn Outreach

A Windows desktop app that runs LinkedIn outreach campaigns on your own account,
with Claude planning the campaigns, reading the pages and writing the messages.

Electron for the UI, a Python sidecar for everything that does work. The UI never
does real work — it sends JSON-RPC calls to the engine, which owns the browser,
the database and the AI.

## What it does

1. **You connect two accounts.** Claude, for the thinking. LinkedIn, in a real
   browser window where you sign in yourself. Nothing works until both are
   connected, so the app gates on it rather than failing on your first click.
2. **You paste a search.** A Sales Navigator search or a LinkedIn people search.
   The app opens it as you, reads the real result count, samples the audience,
   and Claude turns that into a plan — a name, a daily pace inside your limits,
   and an expected completion date.
3. **You approve it.** The prospects are queued and the campaign starts working:
   invitations go out inside your configured schedule and daily ceiling, with a
   note personalised from your own template, spaced by a randomised gap.

Everything is stored locally in SQLite. Both sessions are encrypted at rest and
never leave the machine.

## Architecture

```
┌──────────────────────── Electron ────────────────────────┐
│  renderer (React)                                        │
│      │  window.outreach.engine.call(method, params)      │
│      ▼                                                   │
│  preload  ──contextBridge──▶  main process               │
│                                   │                      │
│                          EngineSupervisor                │
│                    (spawn · handshake · restart)         │
└───────────────────────────────────│──────────────────────┘
                                    │ JSON-RPC 2.0
                                    │ newline-delimited, over stdio
┌───────────────────────────────────▼──────────────────────┐
│  Python engine                                           │
│      RpcServer ──▶ MethodRegistry ──▶ services           │
│                       ├── system.*                       │
│                       ├── ai.*        Claude sign-in     │
│                       ├── linkedin.*  account + search   │
│                       ├── browser.*   the agent          │
│                       └── outreach.*  campaigns          │
│                                                          │
│      store/ ──▶ SQLite     runtime ──▶ Chromium          │
└──────────────────────────────────────────────────────────┘
```

**stdout is the protocol channel.** All engine logging goes to stderr, which the
supervisor captures. A stray `print()` in a service corrupts the stream.

## Layout

| Path | Purpose |
| --- | --- |
| `src/main/` | App lifecycle, engine supervisor, IPC handlers |
| `src/main/engine/supervisor.ts` | Spawn, handshake, crash recovery, shutdown |
| `src/preload/` | The only API exposed to the renderer |
| `src/renderer/src/data/api.ts` | Every UI call to the engine — no mocks anywhere |
| `src/renderer/src/pages/` | Onboarding gate, campaigns dashboard, settings |
| `src/shared/rpc.ts` | Wire contract shared by both TypeScript sides |
| `engine/rpc/` | Protocol, method registry, stdio server |
| `engine/core/db.py` | SQLite connection + versioned migrations |
| `engine/core/secrets.py` | At-rest encryption for stored sessions |
| `engine/store/` | Queries: accounts, campaigns, settings, agent memory |
| `engine/services/ai/` | Claude sign-in and the provider that drives the CLI |
| `engine/services/browser/` | Chromium runtime, page perception, the agent loop |
| `engine/services/linkedin/` | Account connection, search reading |
| `engine/services/outreach/` | Campaigns, the runner, message drafting |

## Prerequisites

- Node.js 20+
- Python 3.11+
- [Claude](https://claude.com/claude-code) installed and on PATH

## Running it

```bash
npm run up           # install everything, then start
```

It installs Node dependencies, creates `.venv`, installs the engine's
dependencies, smoke-tests the engine over stdio, then launches Electron with HMR.

```bash
npm run up -- --setup-only   # prepare dependencies without launching
npm run up -- --clean        # wipe node_modules and .venv first
npm run dev                  # skip the checks, start straight away
```

The app finds the interpreter in this order: `LINKEDIN_OUTREACH_PYTHON`, then
`.venv/`, then `python`/`python3` on PATH.

The engine can also be driven directly, which is the fastest way to test a method:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"system.methods"}' | python engine/main.py
```

## Checks

```bash
npm run typecheck    # main, preload, renderer
pytest -q            # engine
ruff check engine    # engine lint
```

## How the browser automation works

This is the part that decides what the product costs to run, so it is worth
understanding.

### What the model sees

A LinkedIn page is about 2 MB of markup. `engine/services/browser/snapshot.js`
runs **in the page** and walks the DOM computing each element's ARIA role and
accessible name, keeping what a person could see and act on and dropping the
styling, tracking and layout scaffolding. What comes back is roughly 900 tokens:

```
- searchbox "Search" [ref=e1]
- button "Connect" [ref=e12]
- button "More actions" [collapsed] [ref=e13]
  - link "Alex Rivera" [ref=e14]
```

Every reported element is tagged `data-oa-ref` in the page as it is snapshotted,
so the `ref` the model picks resolves back to exactly that element — no selector
guessing.

A **screenshot** is attached only when the text tier could not decide. An image
costs more than the whole text snapshot on its own, so it is a fallback, not a
default.

### Three things keep it cheap

| Mechanism | What it saves |
| --- | --- |
| **Plan cache** | Pages of the same kind hash to one signature. The second visit replays the action that worked and calls no model at all. |
| **Text-first tiering** | The accessibility outline decides most steps. A screenshot is attached only after a step has actually failed. |
| **Model tiering** | "Which of these 40 controls do I click" goes to the fast model. The reasoning model is reached for only after the fast one has been wrong. |

The signature is the part that matters. It is built from the *kind* of page —
`/in/alex-rivera-8837a1` and `/in/sam-okafor-1120b9` both reduce to `/in/*` —
plus the page's own controls. So every prospect's profile shares one cached plan,
while a 1st-degree profile offering *Message* still hashes apart from a
2nd-degree one offering *Connect*. In a campaign that visits the same three page
types a thousand times, this is where nearly all of the saving is.

Each escalation is triggered by a real failure, never by a guess, and a cached
plan that stops working is evicted rather than retried — LinkedIn ships UI
changes, and a stale cache must degrade into one model call, not into a stuck
automation.

**Settings → AI Usage & Cost** shows the real numbers: spend, calls, how many
decisions the cache absorbed, and what fraction needed a screenshot.

### Safety

The agent is given a fixed list of actions it may ask for; anything else is
rejected before it reaches the page. It is told to stop rather than attempt a
captcha or a security checkpoint. The runner paces itself with randomised gaps,
never exceeds the configured daily ceiling, only works on the configured days,
and pauses the campaign after three consecutive failures.

## Connecting accounts

### Claude

The app keeps its own Claude session in `<userData>/claude-session`, isolated via
`CLAUDE_CONFIG_DIR`. Signing in here never touches — or signs out — a Claude
session already on the machine, and uninstalling takes the credentials with it.
There are **no API keys anywhere in the system**; the app authenticates with an
Anthropic account.

`ai.login` runs the interactive flow and pushes `ai.login.url` (the authorisation
link), `ai.login.output` (progress) and `ai.login.complete`.

### LinkedIn

`linkedin.login` opens a real browser window on LinkedIn's own login page. **The
user signs in themselves** — the app never sees a password, and two-factor
prompts and security checkpoints work exactly as they normally would. The engine
watches for the session cookie, reads the account through LinkedIn's own profile
endpoint, and stores the session encrypted.

Encryption is Windows DPAPI, so the stored blob is useless on another account or
machine and nothing key-shaped is written to disk. A key file is used on other
platforms for development.

## Storage

SQLite, in the app's user-data directory (`%APPDATA%/linkedin-outreach` on
Windows). `engine/core/db.py` owns the connection and applies versioned
migrations at startup via `PRAGMA user_version`.

| Table | Holds |
| --- | --- |
| `linkedin_accounts` | The connected identity and its encrypted session |
| `app_settings` | Automation settings as a JSON document |
| `campaigns` | Plan, pace, progress and the approved analysis |
| `prospects` | The queue, with per-person status and timestamps |
| `activity_log` | What happened, newest first |
| `agent_plans` | Cached page understanding — the plan cache |
| `ai_usage` | Every model call with its real cost |

Never edit a released migration; append a new one. Inspect the live database over
RPC with `system.dbInfo`.

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

Only the `system.`, `ai.`, `outreach.`, `linkedin.` and `browser.` namespaces are
reachable from the renderer; the allow-list lives in `src/main/ipc.ts`.

## Building and releasing

Builds run **locally** — there is no CI. Building here is free, reproduces
exactly what a user installs, and catches a broken build before anything is
published rather than after.

```bash
npm run release:build        # build the installers into release/, publish nothing
npm run release              # build, then publish to a GitHub release
npm run release:draft        # publish as a draft
npm run release -- v1.2.0    # build and publish under an explicit tag
```

`scripts/release.sh` lints, tests, type-checks, freezes the engine with
PyInstaller, **smoke-tests the frozen `.exe` from a different directory with a
real JSON-RPC request**, builds the NSIS and portable installers, then uploads
them with `gh release`. Publishing needs the [GitHub CLI](https://cli.github.com)
and `gh auth login`.

### What ships

The installed app is self-contained — **the target machine needs neither Python
nor Node.js**:

| Dependency | How it ships |
| --- | --- |
| Chromium + Node runtime | inside Electron |
| CPython + engine deps | frozen by PyInstaller into `resources/engine/` |
| SQLite | `_sqlite3` + `sqlite3.dll`, bundled with the frozen engine |
| Database file | created on first run in the user-data directory |
| Sessions | created on first sign-in, encrypted, per install |

Two things are deliberately **not** bundled:

- **Claude** is Anthropic's software, so redistributing it inside this installer
  is not ours to do, and a signed-in session is a personal credential that cannot
  ship with a build.
- **The automation's Chromium** is ~150 MB and would triple the installer, so the
  app downloads it on first use and shows real progress while it does.

The app detects whether each is present and says so plainly instead of failing
obscurely.

> No code signing certificate is configured, so SmartScreen will warn on first
> run. Add `win.certificateFile`/`certificatePassword` in `electron-builder.yml`
> when one is available.
