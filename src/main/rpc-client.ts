import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import {
  JSONRPC_VERSION,
  RpcErrorCode,
  type RpcErrorObject,
  type RpcId,
  type RpcMessage,
  type RpcNotification,
  type RpcRequest,
  type RpcResponse
} from '../shared/rpc.js'

export class RpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(error: RpcErrorObject) {
    super(error.message)
    this.name = 'RpcError'
    this.code = error.code
    this.data = error.data
  }
}

interface Pending {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: RpcError) => void
  timer: NodeJS.Timeout | null
}

export interface RpcClientOptions {
  /** Default per-call timeout in ms. 0 disables the timeout. */
  timeoutMs?: number
  /** Called with any stderr/diagnostic line emitted while parsing. */
  onProtocolError?: (message: string, raw: string) => void
}

/**
 * Newline-delimited JSON-RPC 2.0 client speaking over a child process' stdio.
 *
 * One message per line keeps framing trivial and lets the Python side use plain
 * blocking reads. Anything the engine wants to say outside a response (progress,
 * token streams, logs) arrives as a notification and is re-emitted as
 * `notification` / `notification:<method>`.
 */
export class RpcClient extends EventEmitter {
  private readonly pending = new Map<RpcId, Pending>()
  private nextId = 1
  private buffer = ''
  private closed = false

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    private readonly options: RpcClientOptions = {}
  ) {
    super()
    stdout.setEncoding('utf8')
    stdout.on('data', (chunk: string) => this.onData(chunk))
  }

  get pendingCount(): number {
    return this.pending.size
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let index: number
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    } catch {
      // The engine keeps stdout reserved for protocol traffic; anything else is
      // a stray print and is surfaced rather than silently dropped.
      this.options.onProtocolError?.('Non-JSON line on engine stdout', line)
      return
    }

    if ('id' in message && message.id !== null && message.id !== undefined) {
      this.handleResponse(message as RpcResponse)
    } else if ('method' in message) {
      const notification = message as RpcNotification
      this.emit('notification', notification)
      this.emit(`notification:${notification.method}`, notification.params)
    } else {
      this.options.onProtocolError?.('Unroutable JSON-RPC message', line)
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pending.get(response.id as RpcId)
    if (!pending) {
      this.options.onProtocolError?.(
        `Response for unknown id ${String(response.id)}`,
        JSON.stringify(response)
      )
      return
    }
    this.pending.delete(response.id as RpcId)
    if (pending.timer) clearTimeout(pending.timer)

    if (response.error) pending.reject(new RpcError(response.error))
    else pending.resolve(response.result)
  }

  /** Issue a request and wait for its response. */
  call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new RpcError({ code: RpcErrorCode.Unavailable, message: 'Engine transport is closed' })
      )
    }

    const id = this.nextId++
    const request: RpcRequest = { jsonrpc: JSONRPC_VERSION, id, method, params }

    return new Promise<T>((resolve, reject) => {
      const effectiveTimeout = timeoutMs ?? this.options.timeoutMs ?? 30_000
      const timer =
        effectiveTimeout > 0
          ? setTimeout(() => {
              this.pending.delete(id)
              reject(
                new RpcError({
                  code: RpcErrorCode.Timeout,
                  message: `Engine call "${method}" timed out after ${effectiveTimeout}ms`
                })
              )
            }, effectiveTimeout)
          : null

      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      })

      try {
        this.stdin.write(JSON.stringify(request) + '\n')
      } catch (error) {
        this.pending.delete(id)
        if (timer) clearTimeout(timer)
        reject(
          new RpcError({
            code: RpcErrorCode.Unavailable,
            message: `Failed to write to engine stdin: ${(error as Error).message}`
          })
        )
      }
    })
  }

  /** Fire-and-forget message to the engine. */
  notify(method: string, params?: unknown): void {
    if (this.closed) return
    const notification: RpcNotification = { jsonrpc: JSONRPC_VERSION, method, params }
    try {
      this.stdin.write(JSON.stringify(notification) + '\n')
    } catch {
      /* transport is going away; the supervisor will notice */
    }
  }

  /** Reject every in-flight call — used when the sidecar dies or is replaced. */
  dispose(reason = 'Engine transport closed'): void {
    this.closed = true
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(
        new RpcError({
          code: RpcErrorCode.Unavailable,
          message: `${reason} (pending call "${pending.method}")`
        })
      )
    }
    this.removeAllListeners()
  }
}
