import { ProfileManager } from '@main/core/ProfileManager'
import type { IpcHandlerDefinition } from '@main/ipc'
import { IPC_CHANNELS } from '@shared/constants'
import {
  CloneProfileSchema,
  CreateProfileSchema,
  DeleteProfileSchema,
  ProfileFilterSchema,
  UpdateProfileSchema
} from '@shared/schemas'

const profileManager = ProfileManager.getInstance()

export const profileHandlers: IpcHandlerDefinition[] = [
  {
    channel: IPC_CHANNELS.DB.PROFILE_CREATE,
    handler: async (_event, payload) => {
      const input = CreateProfileSchema.parse(payload)
      return profileManager.createProfile(input)
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROFILE_GET_ALL,
    handler: async (_event, payload) => {
      const filter = ProfileFilterSchema.optional().parse(payload)
      return profileManager.getProfiles(filter)
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROFILE_GET_BY_ID,
    handler: async (_event, payload) => {
      const input = DeleteProfileSchema.pick({ id: true }).parse(payload)
      return profileManager.getProfileById(input.id)
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROFILE_UPDATE,
    handler: async (_event, payload) => {
      const input = UpdateProfileSchema.parse(payload)
      return profileManager.updateProfile(input)
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROFILE_DELETE,
    handler: async (_event, payload) => {
      const input = DeleteProfileSchema.parse(payload)
      await profileManager.deleteProfile(input)
      return undefined
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROFILE_CLONE,
    handler: async (_event, payload) => {
      const input = CloneProfileSchema.parse(payload)
      return profileManager.cloneProfile(input)
    }
  }
]
