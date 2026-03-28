import { BrowserLauncher } from '@main/core/BrowserLauncher'
import { ProfileManager } from '@main/core/ProfileManager'
import type { IpcHandlerDefinition } from '@main/ipc'
import { IPC_CHANNELS } from '@shared/constants'
import {
  ExecuteBrowserControlSchema,
  GetBrowserControlTabsSchema,
  StartProfileSchema,
  StopProfileSchema
} from '@shared/schemas'

const profileManager = ProfileManager.getInstance()
const browserLauncher = BrowserLauncher.getInstance()

export const launcherHandlers: IpcHandlerDefinition[] = [
  {
    channel: IPC_CHANNELS.LAUNCHER.START,
    handler: async (_event, payload) => {
      const input = StartProfileSchema.parse(payload)
      const profile = await profileManager.getProfileById(input.profileId)
      return browserLauncher.launch(profile)
    }
  },
  {
    channel: IPC_CHANNELS.LAUNCHER.STOP,
    handler: async (_event, payload) => {
      const input = StopProfileSchema.parse(payload)
      await browserLauncher.terminate(input.profileId)
      return undefined
    }
  },
  {
    channel: IPC_CHANNELS.LAUNCHER.VERIFY,
    handler: async (_event, payload) => {
      const input = StartProfileSchema.parse(payload)
      await browserLauncher.openVerificationPage(input.profileId)
      return undefined
    }
  },
  {
    channel: IPC_CHANNELS.LAUNCHER.CONTROL_TABS,
    handler: async (_event, payload) => {
      const input = GetBrowserControlTabsSchema.parse(payload)
      return browserLauncher.getControlTabs(input.profileId)
    }
  },
  {
    channel: IPC_CHANNELS.LAUNCHER.CONTROL_EXECUTE,
    handler: async (_event, payload) => {
      const input = ExecuteBrowserControlSchema.parse(payload)
      return browserLauncher.executeControlScript(input)
    }
  },
  {
    channel: IPC_CHANNELS.LAUNCHER.GET_STATUS,
    handler: async (_event, payload) => {
      const input = StartProfileSchema.parse(payload)
      return browserLauncher.isRunning(input.profileId) ? 'running' : 'stopped'
    }
  },
  {
    channel: IPC_CHANNELS.LAUNCHER.GET_ALL_RUNNING,
    handler: async () => {
      return browserLauncher.getAllRunning()
    }
  }
]
