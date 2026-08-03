import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { EngineSupervisor } from './engine/supervisor.js'
import { registerIpcHandlers } from './ipc.js'

const engine = new EngineSupervisor()
let mainWindow: BrowserWindow | null = null

engine.on('log', (message: string) => {
  console.log(`[supervisor] ${message}`)
})

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'LinkedIn Outreach',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

// A second instance would fight over the same user data and spawn a second engine.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.hashedsystem.linkedinoutreach')

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    registerIpcHandlers(engine)
    mainWindow = createWindow()

    // The window renders immediately and reflects engine state as it arrives, so a
    // slow or failing sidecar never blocks the UI.
    void engine.start().catch((error) => {
      console.error('[supervisor] Engine failed to start:', error)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', async (event) => {
    if (engine.getState().status === 'stopped') return
    event.preventDefault()
    await engine.stop()
    app.quit()
  })
}
