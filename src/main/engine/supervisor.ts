import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { RpcClient, RpcError } from '../rpc-client.js'
import { resolveEngineLaunchSpec, type EngineLaunchSpec } from './locate.js'
import { RpcErrorCode, type EngineState, type RpcNotification } from '../../shared/rpc.js'

const HANDSHAKE_TIMEOUT_MS = 15_000
const MAX_AUTO_RESTARTS = 5
/** Backoff between automatic restarts, indexed by consecutive failure count. */
const RESTART_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

interface EngineInfo {
  version: string
  python: string
  pid: number
}

/**
 * Owns the Python sidecar process: spawn, handshake, health, crash recovery and
 * shutdown. Everything else in the main process talks to the engine through
 * `call()` and never touches the child process directly.
 */
export class EngineSupervisor extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private client: RpcClient | null = null
  private spec: EngineLaunchSpec | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private stopping = false
  private starting: Promise<void> | null = null

  private state: EngineState = {
    status: 'stopped',
    pid: null,
    version: null,
    python: null,
    startedAt: null,
    restarts: 0,
    lastError: null
  }

  getState(): EngineState {
    return { ...this.state }
  }

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.getState())
  }

  private log(message: string): void {
    this.emit('log', message)
  }

  /** Start the sidecar. Concurrent calls share the same in-flight start. */
  async start(): Promise<void> {
    if (this.starting) return this.starting
    if (this.child && this.state.status === 'ready') return

    this.stopping = false
    this.starting = this.spawnAndHandshake().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async spawnAndHandshake(): Promise<void> {
    this.setState({ status: this.state.restarts > 0 ? 'restarting' : 'starting', lastError: null })

    const spec = resolveEngineLaunchSpec()
    this.spec = spec
    this.log(`Starting engine (${spec.mode}): ${spec.command} ${spec.args.join(' ')}`)

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          // Keep stdout strictly protocol traffic and unbuffered on all platforms.
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8'
        }
      })
    } catch (error) {
      const message = `Failed to spawn engine: ${(error as Error).message}`
      this.setState({ status: 'unavailable', lastError: message })
      throw new Error(message)
    }

    this.child = child

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) this.log(`[engine] ${line.trim()}`)
      }
    })

    child.on('error', (error) => {
      this.log(`Engine process error: ${error.message}`)
      this.setState({ lastError: error.message })
    })

    child.on('exit', (code, signal) => this.onExit(code, signal))

    const client = new RpcClient(child.stdin, child.stdout, {
      timeoutMs: 30_000,
      onProtocolError: (message, raw) => this.log(`Protocol: ${message} :: ${raw.slice(0, 500)}`)
    })
    client.on('notification', (notification: RpcNotification) =>
      this.emit('notification', notification)
    )
    this.client = client

    try {
      const info = await client.call<EngineInfo>('system.info', undefined, HANDSHAKE_TIMEOUT_MS)
      this.setState({
        status: 'ready',
        pid: child.pid ?? null,
        version: info.version,
        python: info.python,
        startedAt: Date.now(),
        lastError: null
      })
      this.log(`Engine ready — v${info.version} on Python ${info.python} (pid ${info.pid})`)
    } catch (error) {
      const message = error instanceof RpcError ? error.message : String(error)
      this.log(`Engine handshake failed: ${message}`)
      this.setState({ status: 'crashed', lastError: message })
      this.killChild()
      throw error
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    const detail = signal ? `signal ${signal}` : `code ${code}`
    this.client?.dispose(`Engine exited (${detail})`)
    this.client = null
    this.child = null

    if (this.stopping) {
      this.setState({ status: 'stopped', pid: null, startedAt: null })
      this.log(`Engine stopped (${detail})`)
      return
    }

    this.log(`Engine exited unexpectedly (${detail})`)
    this.setState({
      status: 'crashed',
      pid: null,
      startedAt: null,
      lastError: `Engine exited with ${detail}`
    })
    this.scheduleRestart()
  }

  private scheduleRestart(): void {
    if (this.restartTimer) return

    if (this.state.restarts >= MAX_AUTO_RESTARTS) {
      this.log(`Engine crashed ${this.state.restarts} times; giving up on automatic restarts.`)
      this.setState({ status: 'unavailable' })
      return
    }

    const delay = RESTART_BACKOFF_MS[Math.min(this.state.restarts, RESTART_BACKOFF_MS.length - 1)]
    this.setState({ restarts: this.state.restarts + 1 })
    this.log(`Restarting engine in ${delay}ms (attempt ${this.state.restarts}).`)

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.start().catch((error) => this.log(`Restart failed: ${(error as Error).message}`))
    }, delay)
  }

  /** Manual restart — clears the crash-loop counter. */
  async restart(): Promise<EngineState> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    await this.stop()
    this.setState({ restarts: 0 })
    await this.start()
    return this.getState()
  }

  /** Ask the engine to exit cleanly, then make sure it actually did. */
  async stop(timeoutMs = 4_000): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    const child = this.child
    if (!child) {
      this.setState({ status: 'stopped', pid: null, startedAt: null })
      return
    }

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    this.client?.notify('system.shutdown')

    const timer = setTimeout(() => {
      this.log('Engine did not exit in time; terminating.')
      this.killChild()
    }, timeoutMs)

    await exited
    clearTimeout(timer)
  }

  private killChild(): void {
    const child = this.child
    if (!child || child.killed) return
    // SIGKILL has no meaning on Windows; Node maps kill() onto TerminateProcess.
    child.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
  }

  /** Forward a JSON-RPC call to the engine. */
  async call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.client || this.state.status !== 'ready') {
      // A crashed sidecar auto-recovers; give the caller one chance to ride that out.
      if (this.starting) await this.starting.catch(() => undefined)
    }
    if (!this.client) {
      throw new RpcError({
        code: RpcErrorCode.Unavailable,
        message: `Engine is ${this.state.status}; cannot call "${method}"`
      })
    }
    return this.client.call<T>(method, params, timeoutMs)
  }

  get launchSpec(): EngineLaunchSpec | null {
    return this.spec
  }
}
