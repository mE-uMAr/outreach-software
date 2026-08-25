/**
 * The renderer's line to the Python engine.
 *
 * `useEngine` is the React-facing view of the same bridge; this module is the
 * plain-function form, so the data layer can call the engine without being
 * inside a component.
 */

import type { EngineEvent } from '../../../shared/rpc.js'

export class EngineError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(message: string, code: number, data?: unknown) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.data = data
  }
}

/** Engine-side codes the UI reacts to differently from a generic failure. */
export const ErrorCode = {
  Unavailable: -32002,
  Timeout: -32001,
  EngineError: -32000
} as const

function bridge(): typeof window.outreach {
  const api = typeof window !== 'undefined' ? window.outreach : undefined
  if (!api) {
    throw new EngineError(
      'The engine bridge is unavailable — this window is not running inside the app.',
      ErrorCode.Unavailable
    )
  }
  return api
}

/** Invoke an engine method, throwing a typed error when it fails. */
export async function call<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
  const response = await bridge().engine.call<T>(method, params, timeoutMs)
  if (!response.ok) {
    throw new EngineError(response.error.message, response.error.code, response.error.data)
  }
  return response.result
}

/**
 * Subscribe to engine notifications whose method starts with `prefix`.
 *
 * Long-running calls (sign-in, search analysis, an agent run) report progress
 * out of band rather than resolving all at once, so the UI listens while it
 * awaits.
 */
export function subscribe(
  prefix: string,
  listener: (event: EngineEvent) => void
): () => void {
  try {
    return bridge().engine.onEvent((event) => {
      if (event.method.startsWith(prefix)) listener(event)
    })
  } catch {
    // No bridge: nothing will ever arrive, and an unsubscribe still has to work.
    return () => undefined
  }
}

/**
 * Run a call while forwarding its progress notifications.
 *
 * The subscription is torn down whether the call resolves or throws, so a failed
 * sign-in does not leave a listener behind that fires on the next attempt.
 */
export async function callWithEvents<T>(
  method: string,
  params: unknown,
  eventPrefix: string,
  onEvent: (event: EngineEvent) => void,
  timeoutMs?: number
): Promise<T> {
  const unsubscribe = subscribe(eventPrefix, onEvent)
  try {
    return await call<T>(method, params, timeoutMs)
  } finally {
    unsubscribe()
  }
}

/** True when the renderer is running inside Electron with the preload loaded. */
export function hasEngine(): boolean {
  return typeof window !== 'undefined' && Boolean(window.outreach)
}
