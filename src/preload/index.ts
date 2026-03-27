import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import type {
  BrowserInstanceInfo,
  CloneProfileInput,
  CreateProfileInput,
  CreateProxyInput,
  DeleteProfileInput,
  IPCResponse,
  LauncherStatusChange,
  Profile,
  ProfileFilter,
  ProxyCheckResult,
  ProxyRecord,
  SystemPaths,
  UpdateProfileInput
} from '@shared/types'

export interface XussApi {
  db: {
    createProfile: (input: CreateProfileInput) => Promise<IPCResponse<Profile>>
    getProfiles: (filter?: ProfileFilter) => Promise<IPCResponse<Profile[]>>
    getProfileById: (input: { id: string }) => Promise<IPCResponse<Profile>>
    updateProfile: (input: UpdateProfileInput) => Promise<IPCResponse<Profile>>
    deleteProfile: (input: DeleteProfileInput) => Promise<IPCResponse<void>>
    cloneProfile: (input: CloneProfileInput) => Promise<IPCResponse<Profile>>
    createProxy: (input: CreateProxyInput) => Promise<IPCResponse<ProxyRecord>>
    getProxies: () => Promise<IPCResponse<ProxyRecord[]>>
    deleteProxy: (input: { id: string }) => Promise<IPCResponse<void>>
    checkProxy: (input: { host: string; port: number }) => Promise<IPCResponse<ProxyCheckResult>>
  }
  launcher: {
    start: (input: { profileId: string }) => Promise<IPCResponse<BrowserInstanceInfo>>
    stop: (input: { profileId: string }) => Promise<IPCResponse<void>>
    getStatus: (input: { profileId: string }) => Promise<IPCResponse<'running' | 'stopped'>>
    getAllRunning: () => Promise<IPCResponse<BrowserInstanceInfo[]>>
  }
  system: {
    getPlatform: () => Promise<IPCResponse<NodeJS.Platform>>
    getVersion: () => Promise<IPCResponse<string>>
    getPaths: () => Promise<IPCResponse<SystemPaths>>
    openDirectory: (input: { path: string }) => Promise<IPCResponse<void>>
  }
  onLauncherStatusChange: (callback: (payload: LauncherStatusChange) => void) => () => void
}

const api: XussApi = {
  db: {
    createProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROFILE_CREATE, input),
    getProfiles: (filter) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROFILE_GET_ALL, filter),
    getProfileById: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROFILE_GET_BY_ID, input),
    updateProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROFILE_UPDATE, input),
    deleteProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROFILE_DELETE, input),
    cloneProfile: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROFILE_CLONE, input),
    createProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_CREATE, input),
    getProxies: () => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_GET_ALL),
    deleteProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_DELETE, input),
    checkProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_CHECK, input)
  },
  launcher: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.START, input),
    stop: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.STOP, input),
    getStatus: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.GET_STATUS, input),
    getAllRunning: () => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.GET_ALL_RUNNING)
  },
  system: {
    getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_PLATFORM),
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_VERSION),
    getPaths: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_PATHS),
    openDirectory: (input) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.OPEN_DIRECTORY, input)
  },
  onLauncherStatusChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LauncherStatusChange) => {
      callback(payload)
    }

    ipcRenderer.on(IPC_CHANNELS.LAUNCHER.STATUS_CHANGE, listener)

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LAUNCHER.STATUS_CHANGE, listener)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as typeof globalThis & { api: XussApi }).api = api
}
