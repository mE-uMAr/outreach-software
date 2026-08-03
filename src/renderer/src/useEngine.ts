import { useCallback, useEffect, useState } from 'react'
import type { EngineEvent, EngineState } from '../../shared/rpc.js'

const INITIAL_STATE: EngineState = {
  status: 'starting',
  pid: null,
  version: null,
  python: null,
  startedAt: null,
  restarts: 0,
  lastError: null
}

/**
 * The bridge is absent when the renderer runs outside Electron (browser preview)
 * or if preload failed to load. Reporting `unavailable` keeps the UI usable
 * instead of throwing on every engine touch.
 */
function bridge(): typeof window.outreach | null {
  return typeof window !== 'undefined' && window.outreach ? window.outreach : null
}

const NO_BRIDGE_STATE: EngineState = {
  ...INITIAL_STATE,
  status: 'unavailable',
  lastError: 'Engine bridge unavailable (renderer is not running inside Electron)'
}

/**
 * Single access point to the engine for the UI: live supervisor state, a typed
 * `call` that throws on RPC errors, and an event subscription.
 */
export function useEngine(): {
  state: EngineState
  call: <T>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>
  restart: () => Promise<void>
} {
  const [state, setState] = useState<EngineState>(INITIAL_STATE)

  useEffect(() => {
    const api = bridge()
    if (!api) {
      setState(NO_BRIDGE_STATE)
      return
    }
    void api.engine.getState().then(setState)
    return api.engine.onStateChanged(setState)
  }, [])

  const call = useCallback(async <T,>(method: string, params?: unknown, timeoutMs?: number) => {
    const api = bridge()
    if (!api) throw new Error(NO_BRIDGE_STATE.lastError as string)

    const response = await api.engine.call<T>(method, params, timeoutMs)
    if (!response.ok) {
      throw Object.assign(new Error(response.error.message), { code: response.error.code })
    }
    return response.result
  }, [])

  const restart = useCallback(async () => {
    const api = bridge()
    if (!api) return
    setState(await api.engine.restart())
  }, [])

  return { state, call, restart }
}

/** Subscribe to engine notifications, optionally filtered by method name. */
export function useEngineEvents(
  listener: (event: EngineEvent) => void,
  methodFilter?: string
): void {
  useEffect(() => {
    const api = bridge()
    if (!api) return

    return api.engine.onEvent((event) => {
      if (methodFilter && event.method !== methodFilter) return
      listener(event)
    })
  }, [listener, methodFilter])
}
