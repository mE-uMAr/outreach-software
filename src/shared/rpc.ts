/**
 * Wire contract shared by the Electron main process, the preload bridge and the
 * renderer. The Python engine implements the same shapes in engine/rpc/protocol.py.
 */

export const JSONRPC_VERSION = '2.0'

export type RpcId = number | string

export interface RpcRequest {
  jsonrpc: typeof JSONRPC_VERSION
  id: RpcId
  method: string
  params?: unknown
}

export interface RpcNotification {
  jsonrpc: typeof JSONRPC_VERSION
  method: string
  params?: unknown
}

export interface RpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export interface RpcResponse {
  jsonrpc: typeof JSONRPC_VERSION
  id: RpcId | null
  result?: unknown
  error?: RpcErrorObject
}

export type RpcMessage = RpcResponse | RpcNotification

/** JSON-RPC 2.0 reserved codes plus engine-specific ones. */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  /** Engine-side application error (raised by a service). */
  EngineError: -32000,
  /** The call did not complete within the client timeout. */
  Timeout: -32001,
  /** The sidecar is not running / died before answering. */
  Unavailable: -32002
} as const

/** Lifecycle of the Python sidecar as reported to the renderer. */
export type EngineStatus =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'restarting'
  | 'crashed'
  | 'unavailable'

export interface EngineState {
  status: EngineStatus
  pid: number | null
  /** Engine version reported by system.info once the handshake completes. */
  version: string | null
  python: string | null
  startedAt: number | null
  restarts: number
  lastError: string | null
}

/** IPC channel names used between renderer and main. */
export const IpcChannel = {
  /** renderer -> main, invoke: forward a JSON-RPC call to the engine */
  EngineCall: 'engine:call',
  /** renderer -> main, invoke: read the current supervisor state */
  EngineState: 'engine:state',
  /** renderer -> main, invoke: force a restart of the sidecar */
  EngineRestart: 'engine:restart',
  /** main -> renderer, send: supervisor state changed */
  EngineStateChanged: 'engine:state-changed',
  /** main -> renderer, send: an engine notification (progress, stream chunk, log) */
  EngineEvent: 'engine:event'
} as const

/** Payload of IpcChannel.EngineEvent. */
export interface EngineEvent<T = unknown> {
  method: string
  params: T
}
