import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { BrowserLauncher } from '@main/core/BrowserLauncher'
import { DatabaseManager } from '@main/core/DatabaseManager'
import { registerIpcHandlers } from '@main/ipc'
import { configureLogger, logger } from '@main/utils/logger'
import { ensureAppDirectories } from '@main/utils/paths'
import { IPC_CHANNELS } from '@shared/constants'
import type { LauncherStatusChange } from '@shared/types'

if (!app.isPackaged) {
  app.setPath('userData', join(process.cwd(), '.xuss-data'))
}

function createWindow(): BrowserWindow {
  const windowInstance = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#eef4ff',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webSecurity: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  windowInstance.on('ready-to-show', () => {
    windowInstance.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void windowInstance.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void windowInstance.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return windowInstance
}

function wireLauncherEvents(): void {
  const browserLauncher = BrowserLauncher.getInstance()

  browserLauncher.on('statusChange', (event: LauncherStatusChange) => {
    BrowserWindow.getAllWindows().forEach((windowInstance) => {
      windowInstance.webContents.send(IPC_CHANNELS.LAUNCHER.STATUS_CHANGE, event)
    })
  })
}

async function bootstrap(): Promise<void> {
  configureLogger()
  logger.info('Starting XussBrowser')

  await ensureAppDirectories()
  await DatabaseManager.getInstance().getClient()

  registerIpcHandlers()
  wireLauncherEvents()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}

app
  .whenReady()
  .then(() => {
    void bootstrap()
  })
  .catch((error) => {
    logger.error('Bootstrap failed', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void DatabaseManager.getInstance().disconnect()
})
