import { ProfileManager } from '@main/core/ProfileManager'
import type { IpcHandlerDefinition } from '@main/ipc'
import { IPC_CHANNELS } from '@shared/constants'
import { CreateGroupSchema, DeleteGroupSchema, UpdateGroupSchema } from '@shared/schemas'

const profileManager = ProfileManager.getInstance()

export const groupHandlers: IpcHandlerDefinition[] = [
  {
    channel: IPC_CHANNELS.DB.GROUP_CREATE,
    handler: async (_event, payload) => {
      const input = CreateGroupSchema.parse(payload)
      return profileManager.createGroup(input)
    }
  },
  {
    channel: IPC_CHANNELS.DB.GROUP_GET_ALL,
    handler: async () => {
      return profileManager.getGroups()
    }
  },
  {
    channel: IPC_CHANNELS.DB.GROUP_UPDATE,
    handler: async (_event, payload) => {
      const input = UpdateGroupSchema.parse(payload)
      return profileManager.updateGroup(input)
    }
  },
  {
    channel: IPC_CHANNELS.DB.GROUP_DELETE,
    handler: async (_event, payload) => {
      const input = DeleteGroupSchema.parse(payload)
      await profileManager.deleteGroup(input)
      return undefined
    }
  }
]
