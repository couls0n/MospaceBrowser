export type IPCResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

export type ProxyType = 'none' | 'http' | 'https' | 'socks5'
export type ColorScheme = 'system' | 'light' | 'dark'
export type LauncherStatus = 'started' | 'stopped' | 'crashed'

export interface BrowserWindowConfig {
  width: number
  height: number
  pixelRatio: number
}

export interface BrowserProfileConfig {
  locale: string
  timezone: string
  colorScheme: ColorScheme
  homeUrl: string
  window: BrowserWindowConfig
}

export interface ProfileProxyConfig {
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
}

export interface Profile {
  id: string
  name: string
  notes?: string
  createdAt: string
  updatedAt: string
  browserConfig: BrowserProfileConfig
  proxyConfig?: ProfileProxyConfig
  storagePath: string
  groupId?: string
}

export interface CreateProfileInput {
  name: string
  notes?: string
  browserConfig: BrowserProfileConfig
  proxyConfig?: ProfileProxyConfig
  groupId?: string
}

export interface UpdateProfileInput {
  id: string
  name?: string
  notes?: string
  browserConfig?: BrowserProfileConfig
  proxyConfig?: ProfileProxyConfig
  groupId?: string
}

export interface DeleteProfileInput {
  id: string
  removeData?: boolean
}

export interface CloneProfileInput {
  id: string
  name?: string
}

export interface ProfileFilter {
  groupId?: string
}

export interface ProxyRecord {
  id: string
  name?: string
  type: ProxyType
  host: string
  port: number
  username?: string
  password?: string
  countryCode?: string
  latency?: number
  lastChecked?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProxyInput {
  name?: string
  type: Exclude<ProxyType, 'none'>
  host: string
  port: number
  username?: string
  password?: string
}

export interface ProxyCheckResult {
  success: boolean
  latency?: number
  error?: string
}

export interface BrowserInstanceInfo {
  pid: number
  profileId: string
  debuggingPort: number
  websocketUrl?: string
  startTime: number
}

export interface LauncherStatusChange {
  profileId: string
  status: LauncherStatus
  data?: BrowserInstanceInfo
}

export interface SystemPaths {
  userData: string
  logs: string
  database: string
  profiles: string
}
