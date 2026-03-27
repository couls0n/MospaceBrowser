import { createConnection } from 'node:net'
import { ProfileManager } from '@main/core/ProfileManager'
import type { IpcHandlerDefinition } from '@main/ipc'
import { IPC_CHANNELS } from '@shared/constants'
import { CheckProxySchema, CreateProxySchema, DeleteProxySchema } from '@shared/schemas'
import type { ProxyCheckResult } from '@shared/types'

const profileManager = ProfileManager.getInstance()

async function checkProxyReachability(host: string, port: number): Promise<ProxyCheckResult> {
  return new Promise<ProxyCheckResult>((resolve) => {
    const startedAt = Date.now()
    const socket = createConnection({ host, port })

    socket.setTimeout(5000)

    socket.once('connect', () => {
      const latency = Date.now() - startedAt
      socket.end()
      resolve({
        success: true,
        latency
      })
    })

    socket.once('timeout', () => {
      socket.destroy()
      resolve({
        success: false,
        error: 'Connection timeout.'
      })
    })

    socket.once('error', (error) => {
      resolve({
        success: false,
        error: error.message
      })
    })
  })
}

export const proxyHandlers: IpcHandlerDefinition[] = [
  {
    channel: IPC_CHANNELS.DB.PROXY_CREATE,
    handler: async (_event, payload) => {
      const input = CreateProxySchema.parse(payload)
      return profileManager.createProxy(input)
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROXY_GET_ALL,
    handler: async () => {
      return profileManager.getProxies()
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROXY_DELETE,
    handler: async (_event, payload) => {
      const input = DeleteProxySchema.parse(payload)
      await profileManager.deleteProxy(input.id)
      return undefined
    }
  },
  {
    channel: IPC_CHANNELS.DB.PROXY_CHECK,
    handler: async (_event, payload) => {
      const input = CheckProxySchema.parse(payload)
      return checkProxyReachability(input.host, input.port)
    }
  }
]
