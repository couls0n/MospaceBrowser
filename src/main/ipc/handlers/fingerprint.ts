import { ProfileManager } from '@main/core/ProfileManager'
import type { IpcHandlerDefinition } from '@main/ipc'
import { IPC_CHANNELS } from '@shared/constants'
import { GenerateFingerprintSchema, ValidateFingerprintSchema } from '@shared/schemas'
import type { FingerprintConfig, FingerprintGenerationOptions } from '@shared/types'

const profileManager = ProfileManager.getInstance()

export const fingerprintHandlers: IpcHandlerDefinition[] = [
  {
    channel: IPC_CHANNELS.FINGERPRINT.GENERATE,
    handler: async (_event, payload): Promise<FingerprintConfig> => {
      const input = GenerateFingerprintSchema.parse(payload)
      const options: FingerprintGenerationOptions = {
        seed: input.seed,
        ip: input.ip,
        os: input.os
      }
      return profileManager.generateFingerprint(options)
    }
  },
  {
    channel: IPC_CHANNELS.FINGERPRINT.VALIDATE,
    handler: async (_event, payload): Promise<boolean> => {
      const input = ValidateFingerprintSchema.parse(payload)
      return profileManager.validateFingerprint(input.config)
    }
  }
]
