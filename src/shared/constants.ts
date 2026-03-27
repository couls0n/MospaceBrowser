import type { BrowserProfileConfig } from '@shared/types'

export const IPC_CHANNELS = {
  DB: {
    PROFILE_CREATE: 'db:profile:create',
    PROFILE_GET_ALL: 'db:profile:getAll',
    PROFILE_GET_BY_ID: 'db:profile:getById',
    PROFILE_UPDATE: 'db:profile:update',
    PROFILE_DELETE: 'db:profile:delete',
    PROFILE_CLONE: 'db:profile:clone',
    PROXY_CREATE: 'db:proxy:create',
    PROXY_GET_ALL: 'db:proxy:getAll',
    PROXY_DELETE: 'db:proxy:delete',
    PROXY_CHECK: 'db:proxy:check'
  },
  LAUNCHER: {
    START: 'launcher:start',
    STOP: 'launcher:stop',
    GET_STATUS: 'launcher:getStatus',
    GET_ALL_RUNNING: 'launcher:getAllRunning',
    STATUS_CHANGE: 'launcher:statusChange'
  },
  SYSTEM: {
    GET_PLATFORM: 'system:getPlatform',
    GET_VERSION: 'system:getVersion',
    GET_PATHS: 'system:getPaths',
    OPEN_DIRECTORY: 'system:openDirectory'
  }
} as const

export const DEFAULT_PORTS = {
  DEBUGGER_MIN: 9223,
  DEBUGGER_MAX: 9323
} as const

export const DEFAULT_BROWSER_PATH =
  'D:/Fingerprint-everything/142.0.7444.175/ungoogled-chromium_142.0.7444.175-1.1_windows_x64/chrome.exe'

export const DEFAULT_BROWSER_CONFIG: BrowserProfileConfig = {
  locale: 'en-US',
  timezone: 'Asia/Hong_Kong',
  colorScheme: 'system',
  homeUrl: 'https://example.com',
  window: {
    width: 1400,
    height: 900,
    pixelRatio: 1
  }
}
