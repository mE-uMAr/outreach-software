import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type EngineEvent, type EngineState } from '../shared/rpc.js'
import type { EngineCallResult } from '../main/ipc.js'

/**
 * The only surface the renderer gets. No ipcRenderer, no Node — every engine
 * interaction goes through these functions and is namespace-checked in main.
 */
const api = {
  engine: {
    /** Invoke a JSON-RPC method on the Python engine. */
    call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<EngineCallResult<T>> {
      return ipcRenderer.invoke(IpcChannel.EngineCall, { method, params, timeoutMs })
    },

    /** Current supervisor state (status, pid, version, restart count). */
    getState(): Promise<EngineState> {
      return ipcRenderer.invoke(IpcChannel.EngineState)
    },

    /** Force a clean restart of the sidecar. */
    restart(): Promise<EngineState> {
      return ipcRenderer.invoke(IpcChannel.EngineRestart)
    },

    /** Subscribe to supervisor state changes. Returns an unsubscribe function. */
    onStateChanged(listener: (state: EngineState) => void): () => void {
      const handler = (_event: IpcRendererEvent, state: EngineState): void => listener(state)
      ipcRenderer.on(IpcChannel.EngineStateChanged, handler)
      return () => ipcRenderer.removeListener(IpcChannel.EngineStateChanged, handler)
    },

    /** Subscribe to engine-pushed notifications (progress, stream chunks, logs). */
    onEvent(listener: (event: EngineEvent) => void): () => void {
      const handler = (_event: IpcRendererEvent, payload: EngineEvent): void => listener(payload)
      ipcRenderer.on(IpcChannel.EngineEvent, handler)
      return () => ipcRenderer.removeListener(IpcChannel.EngineEvent, handler)
    }
  },

  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }
}

export type OutreachApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('outreach', api)
} else {
  // contextIsolation is on in every window we create; this keeps a broken config
  // from silently producing a renderer with no API at all.
  ;(globalThis as unknown as { outreach: OutreachApi }).outreach = api
}
