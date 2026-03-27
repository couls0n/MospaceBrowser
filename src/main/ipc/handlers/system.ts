import { app, dialog, shell } from 'electron'
import { AppSettingsManager } from '@main/core/AppSettingsManager'
import type { IpcHandlerDefinition } from '@main/ipc'
import { getAppPaths } from '@main/utils/paths'
import { IPC_CHANNELS } from '@shared/constants'
import { OpenDirectorySchema, UpdateAppSettingsSchema } from '@shared/schemas'

const appSettingsManager = AppSettingsManager.getInstance()
export const systemHandlers: IpcHandlerDefinition[] = [
  {
    channel: IPC_CHANNELS.SYSTEM.GET_PLATFORM,
    handler: async () => process.platform
  },
  {
    channel: IPC_CHANNELS.SYSTEM.GET_VERSION,
    handler: async () => app.getVersion()
  },
  {
    channel: IPC_CHANNELS.SYSTEM.GET_PATHS,
    handler: async () => {
      const paths = getAppPaths()
      return {
        userData: paths.userData,
        logs: paths.logs,
        database: paths.database,
        profiles: paths.profiles
      }
    }
  },
  {
    channel: IPC_CHANNELS.SYSTEM.OPEN_DIRECTORY,
    handler: async (_event, payload) => {
      const input = OpenDirectorySchema.parse(payload)
      await shell.openPath(input.path)
      return undefined
    }
  },
  {
    channel: IPC_CHANNELS.SYSTEM.GET_SETTINGS,
    handler: async () => {
      return appSettingsManager.getSettings()
    }
  },
  {
    channel: IPC_CHANNELS.SYSTEM.UPDATE_SETTINGS,
    handler: async (_event, payload) => {
      const input = UpdateAppSettingsSchema.parse(payload)
      return appSettingsManager.updateSettings(input)
    }
  },
  {
    channel: IPC_CHANNELS.SYSTEM.GET_BROWSER_EXECUTABLE,
    handler: async () => {
      return appSettingsManager.getBrowserExecutablePathInfo()
    }
  },
  {
    channel: IPC_CHANNELS.SYSTEM.PICK_BROWSER_EXECUTABLE,
    handler: async () => {
      const result = await dialog.showOpenDialog({
        title: 'Select Chromium or Chrome executable',
        properties: ['openFile'],
        filters: [
          { name: 'Executable', extensions: ['exe', 'app', 'bin'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      return result.canceled ? undefined : result.filePaths[0]
    }
  }
]
