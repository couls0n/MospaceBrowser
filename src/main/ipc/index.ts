import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fingerprintHandlers } from '@main/ipc/handlers/fingerprint'
import { launcherHandlers } from '@main/ipc/handlers/launcher'
import { profileHandlers } from '@main/ipc/handlers/profile'
import { proxyHandlers } from '@main/ipc/handlers/proxy'
import { systemHandlers } from '@main/ipc/handlers/system'
import { logger } from '@main/utils/logger'
import type { IPCResponse } from '@shared/types'

export interface IpcHandlerDefinition {
  channel: string
  handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown IPC error.'
}

function toSuccess<T>(data: T): IPCResponse<T> {
  return {
    success: true,
    data
  }
}

function toFailure(error: unknown): IPCResponse<never> {
  return {
    success: false,
    error: asErrorMessage(error)
  }
}

export function registerIpcHandlers(): void {
  const handlers = [
    ...profileHandlers,
    ...proxyHandlers,
    ...launcherHandlers,
    ...fingerprintHandlers,
    ...systemHandlers
  ]

  handlers.forEach((definition) => {
    ipcMain.removeHandler(definition.channel)
    ipcMain.handle(definition.channel, async (event, payload) => {
      try {
        const result = await definition.handler(event, payload)
        return toSuccess(result)
      } catch (error) {
        logger.error(`IPC ${definition.channel} failed`, error)
        return toFailure(error)
      }
    })
  })
}
