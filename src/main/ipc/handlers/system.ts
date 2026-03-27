import { app, shell } from 'electron'
import type { IpcHandlerDefinition } from '@main/ipc'
import { getAppPaths } from '@main/utils/paths'
import { IPC_CHANNELS } from '@shared/constants'
import { OpenDirectorySchema } from '@shared/schemas'

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
  }
]
