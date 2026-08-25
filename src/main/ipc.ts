import { BrowserWindow, ipcMain } from 'electron'
import { RpcError } from './rpc-client.js'
import type { EngineSupervisor } from './engine/supervisor.js'
import { IpcChannel, RpcErrorCode, type RpcNotification } from '../shared/rpc.js'

export interface EngineCallRequest {
  method: string
  params?: unknown
  timeoutMs?: number
}

/**
 * Result envelope. Errors are returned as data rather than thrown across the IPC
 * boundary so the renderer keeps the JSON-RPC code instead of a stringified stack.
 */
export type EngineCallResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { code: number; message: string; data?: unknown } }

/** Methods the renderer is allowed to invoke, by namespace prefix. */
const ALLOWED_NAMESPACES = ['system.', 'ai.', 'outreach.', 'linkedin.', 'browser.']

function isAllowed(method: string): boolean {
  return ALLOWED_NAMESPACES.some((prefix) => method.startsWith(prefix))
}

export function registerIpcHandlers(engine: EngineSupervisor): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  engine.on('state', (state) => broadcast(IpcChannel.EngineStateChanged, state))
  engine.on('notification', (notification: RpcNotification) =>
    broadcast(IpcChannel.EngineEvent, {
      method: notification.method,
      params: notification.params ?? null
    })
  )

  ipcMain.handle(IpcChannel.EngineState, () => engine.getState())

  ipcMain.handle(IpcChannel.EngineRestart, async () => {
    await engine.restart()
    return engine.getState()
  })

  ipcMain.handle(
    IpcChannel.EngineCall,
    async (_event, request: EngineCallRequest): Promise<EngineCallResult> => {
      if (!request || typeof request.method !== 'string') {
        return {
          ok: false,
          error: { code: RpcErrorCode.InvalidRequest, message: 'A method name is required' }
        }
      }

      if (!isAllowed(request.method)) {
        return {
          ok: false,
          error: {
            code: RpcErrorCode.MethodNotFound,
            message: `Method "${request.method}" is not exposed to the renderer`
          }
        }
      }

      try {
        const result = await engine.call(request.method, request.params, request.timeoutMs)
        return { ok: true, result }
      } catch (error) {
        if (error instanceof RpcError) {
          return { ok: false, error: { code: error.code, message: error.message, data: error.data } }
        }
        return {
          ok: false,
          error: { code: RpcErrorCode.InternalError, message: (error as Error).message }
        }
      }
    }
  )
}
