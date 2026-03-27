export type IPCResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

export type ProxyType = 'none' | 'http' | 'https' | 'socks5'
export type ColorScheme = 'system' | 'light' | 'dark'
export type LauncherStatus = 'started' | 'stopped' | 'crashed'
export type OSType = 'win10' | 'win11' | 'macos' | 'linux'
export type BrowserPathSource = 'environment' | 'settings' | 'auto-detected' | 'default'

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
  fingerprintEnabled: boolean
  fingerprintOs?: OSType
  fingerprintConfig?: FingerprintConfig
  storagePath: string
  groupId?: string
}

export interface CreateProfileInput {
  name: string
  notes?: string
  browserConfig: BrowserProfileConfig
  proxyConfig?: ProfileProxyConfig
  fingerprintEnabled?: boolean
  fingerprintOs?: OSType
  fingerprintConfig?: FingerprintConfig
  groupId?: string
}

export interface UpdateProfileInput {
  id: string
  name?: string
  notes?: string
  browserConfig?: BrowserProfileConfig
  proxyConfig?: ProfileProxyConfig
  fingerprintEnabled?: boolean
  fingerprintOs?: OSType
  fingerprintConfig?: FingerprintConfig
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

export interface AppSettings {
  browserExecutablePath?: string
}

export interface BrowserExecutablePathInfo {
  configuredPath?: string
  resolvedPath: string
  source: BrowserPathSource
}

// ============================================
// Fingerprint Generation Types (Phase 3)
// ============================================

/**
 * Screen configuration for fingerprint generation.
 */
export interface ScreenConfig {
  width: number
  height: number
  colorDepth: number
  pixelRatio: number
}

/**
 * GPU information for fingerprint generation.
 */
export interface GpuInfo {
  vendor: string
  renderer: string
}

/**
 * Hardware profile containing device specifications.
 */
export interface HardwareProfile {
  cpuCores: number
  memory: number // GB
  screen: ScreenConfig
}

/**
 * Advanced fingerprint settings for anti-detection.
 */
export interface AdvancedFingerprintSettings {
  canvasNoise: number // 0-10
  webglNoise: boolean
  audioNoise: boolean
}

/**
 * Software fingerprint settings.
 */
export interface SoftwareFingerprintSettings {
  timezone: string // IANA timezone, e.g., "America/New_York"
  locale: string // e.g., "en-US"
  platform: string // "Win32", "MacIntel", "Linux x86_64"
  doNotTrack: boolean
}

/**
 * Hardware fingerprint settings.
 */
export interface HardwareFingerprintSettings {
  cpuCores: number
  memory: number // GB
  screen: ScreenConfig
  gpu: GpuInfo
  fonts: string[]
}

/**
 * Complete fingerprint configuration.
 */
export interface FingerprintConfig {
  userAgent: string
  secChUa?: string
  hardware: HardwareFingerprintSettings
  software: SoftwareFingerprintSettings
  advanced: AdvancedFingerprintSettings
}

/**
 * Options for generating a fingerprint.
 */
export interface FingerprintGenerationOptions {
  seed: string // Profile ID used as seed for deterministic generation
  ip?: string // Optional IP for timezone/geo matching
  os?: OSType // Optional preferred OS
}

/**
 * Fingerprint template for a specific OS.
 */
export interface FingerprintTemplate {
  os: OSType
  osVersion: string
  weight: number
  userAgent: string
  secChUa: string
  platform: string
  typicalScreens: Array<{
    width: number
    height: number
    pixelRatio: number
  }>
  typicalFonts: string[]
  cpuDistribution: Array<{
    cores: number
    weight: number
  }>
  memoryDistribution: Array<{
    gb: number
    weight: number
    maxCores: number
  }>
}
