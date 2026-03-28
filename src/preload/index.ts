import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@shared/constants'
import type {
  AppSettings,
  BrowserControlExecutionResult,
  BrowserControlTab,
  BrowserInstanceInfo,
  BrowserExecutablePathInfo,
  CloneProfileInput,
  CreateProfileInput,
  CreateGroupInput,
  CreateProxyInput,
  DeleteGroupInput,
  DeleteProfileInput,
  ExecuteBrowserControlInput,
  FingerprintConfig,
  FingerprintGenerationOptions,
  GroupRecord,
  IPCResponse,
  LauncherStatusChange,
  Profile,
  ProfileFilter,
  ProxyCheckResult,
  ProxyRecord,
  SystemPaths,
  UpdateGroupInput,
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
    createGroup: (input: CreateGroupInput) => Promise<IPCResponse<GroupRecord>>
    getGroups: () => Promise<IPCResponse<GroupRecord[]>>
    updateGroup: (input: UpdateGroupInput) => Promise<IPCResponse<GroupRecord>>
    deleteGroup: (input: DeleteGroupInput) => Promise<IPCResponse<void>>
    createProxy: (input: CreateProxyInput) => Promise<IPCResponse<ProxyRecord>>
    getProxies: () => Promise<IPCResponse<ProxyRecord[]>>
    deleteProxy: (input: { id: string }) => Promise<IPCResponse<void>>
    checkProxy: (input: { host: string; port: number }) => Promise<IPCResponse<ProxyCheckResult>>
  }
  launcher: {
    start: (input: { profileId: string }) => Promise<IPCResponse<BrowserInstanceInfo>>
    stop: (input: { profileId: string }) => Promise<IPCResponse<void>>
    verify: (input: { profileId: string }) => Promise<IPCResponse<void>>
    getControlTabs: (input: { profileId: string }) => Promise<IPCResponse<BrowserControlTab[]>>
    executeControl: (
      input: ExecuteBrowserControlInput
    ) => Promise<IPCResponse<BrowserControlExecutionResult>>
    getStatus: (input: { profileId: string }) => Promise<IPCResponse<'running' | 'stopped'>>
    getAllRunning: () => Promise<IPCResponse<BrowserInstanceInfo[]>>
  }
  fingerprint: {
    generate: (options: FingerprintGenerationOptions) => Promise<IPCResponse<FingerprintConfig>>
    validate: (config: FingerprintConfig) => Promise<IPCResponse<boolean>>
  }
  system: {
    getPlatform: () => Promise<IPCResponse<NodeJS.Platform>>
    getVersion: () => Promise<IPCResponse<string>>
    getPaths: () => Promise<IPCResponse<SystemPaths>>
    openDirectory: (input: { path: string }) => Promise<IPCResponse<void>>
    getSettings: () => Promise<IPCResponse<AppSettings>>
    updateSettings: (input: AppSettings) => Promise<IPCResponse<AppSettings>>
    getBrowserExecutable: () => Promise<IPCResponse<BrowserExecutablePathInfo>>
    pickBrowserExecutable: () => Promise<IPCResponse<string | undefined>>
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
    createGroup: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.GROUP_CREATE, input),
    getGroups: () => ipcRenderer.invoke(IPC_CHANNELS.DB.GROUP_GET_ALL),
    updateGroup: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.GROUP_UPDATE, input),
    deleteGroup: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.GROUP_DELETE, input),
    createProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_CREATE, input),
    getProxies: () => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_GET_ALL),
    deleteProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_DELETE, input),
    checkProxy: (input) => ipcRenderer.invoke(IPC_CHANNELS.DB.PROXY_CHECK, input)
  },
  launcher: {
    start: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.START, input),
    stop: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.STOP, input),
    verify: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.VERIFY, input),
    getControlTabs: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.CONTROL_TABS, input),
    executeControl: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.CONTROL_EXECUTE, input),
    getStatus: (input) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.GET_STATUS, input),
    getAllRunning: () => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER.GET_ALL_RUNNING)
  },
  fingerprint: {
    generate: (options) => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT.GENERATE, options),
    validate: (config) => ipcRenderer.invoke(IPC_CHANNELS.FINGERPRINT.VALIDATE, { config })
  },
  system: {
    getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_PLATFORM),
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_VERSION),
    getPaths: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_PATHS),
    openDirectory: (input) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.OPEN_DIRECTORY, input),
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_SETTINGS),
    updateSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.UPDATE_SETTINGS, input),
    getBrowserExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_BROWSER_EXECUTABLE),
    pickBrowserExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.PICK_BROWSER_EXECUTABLE)
  },
  onLauncherStatusChange: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LauncherStatusChange): void => {
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
