import { constants as fsConstants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_BROWSER_PATH } from '@shared/constants'
import type { AppSettings, BrowserExecutablePathInfo } from '@shared/types'
import { getAppPaths } from '@main/utils/paths'

function normalizePath(path?: string): string | undefined {
  const normalized = path?.trim()
  return normalized ? normalized : undefined
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()

  return paths.flatMap((path) => {
    const normalized = normalizePath(path)

    if (!normalized || seen.has(normalized)) {
      return []
    }

    seen.add(normalized)
    return [normalized]
  })
}

export class AppSettingsManager {
  private static instance: AppSettingsManager | null = null
  private cache: AppSettings | null = null

  public static getInstance(): AppSettingsManager {
    if (!AppSettingsManager.instance) {
      AppSettingsManager.instance = new AppSettingsManager()
    }

    return AppSettingsManager.instance
  }

  public async getSettings(): Promise<AppSettings> {
    if (this.cache) {
      return this.cache
    }

    const settingsPath = getAppPaths().settings

    try {
      const raw = await readFile(settingsPath, 'utf-8')
      const parsed = JSON.parse(raw) as AppSettings
      this.cache = {
        browserExecutablePath: normalizePath(parsed.browserExecutablePath)
      }
    } catch {
      this.cache = {}
    }

    return this.cache
  }

  public async updateSettings(input: AppSettings): Promise<AppSettings> {
    const nextSettings: AppSettings = {
      browserExecutablePath: normalizePath(input.browserExecutablePath)
    }

    if (nextSettings.browserExecutablePath) {
      await access(nextSettings.browserExecutablePath, fsConstants.F_OK)
    }

    const settingsPath = getAppPaths().settings
    await writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf-8')
    this.cache = nextSettings

    return nextSettings
  }

  public async getBrowserExecutablePathInfo(): Promise<BrowserExecutablePathInfo> {
    const settings = await this.getSettings()
    const envPath = normalizePath(process.env.XUSS_BROWSER_EXECUTABLE)
    const configuredPath = settings.browserExecutablePath

    if (await this.pathExists(envPath)) {
      return {
        configuredPath,
        resolvedPath: envPath!,
        source: 'environment'
      }
    }

    if (await this.pathExists(configuredPath)) {
      return {
        configuredPath,
        resolvedPath: configuredPath!,
        source: 'settings'
      }
    }

    const autoDetectedPath = await this.findFirstExistingPath(this.getAutoDetectedCandidates())

    if (autoDetectedPath) {
      return {
        configuredPath,
        resolvedPath: autoDetectedPath,
        source: autoDetectedPath === DEFAULT_BROWSER_PATH ? 'default' : 'auto-detected'
      }
    }

    return {
      configuredPath,
      resolvedPath: envPath ?? configuredPath ?? DEFAULT_BROWSER_PATH,
      source: 'default'
    }
  }

  public async resolveBrowserExecutablePath(): Promise<string> {
    const browserPathInfo = await this.getBrowserExecutablePathInfo()

    if (await this.pathExists(browserPathInfo.resolvedPath)) {
      return browserPathInfo.resolvedPath
    }

    throw new Error(
      [
        'No Chromium executable was found.',
        'Please configure a valid browser path in Settings or set XUSS_BROWSER_EXECUTABLE.',
        `Last resolved path: ${browserPathInfo.resolvedPath}`
      ].join(' ')
    )
  }

  private async findFirstExistingPath(paths: string[]): Promise<string | undefined> {
    for (const path of paths) {
      if (await this.pathExists(path)) {
        return path
      }
    }

    return undefined
  }

  private async pathExists(path?: string): Promise<boolean> {
    if (!path) {
      return false
    }

    try {
      await access(path, fsConstants.F_OK)
      return true
    } catch {
      return false
    }
  }

  private getAutoDetectedCandidates(): string[] {
    const windowsCandidates = [
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.PROGRAMFILES &&
        join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'),
      process.env.PROGRAMFILES &&
        join(process.env.PROGRAMFILES, 'Chromium', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        join(process.env['PROGRAMFILES(X86)'], 'Chromium', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      process.env.PROGRAMFILES &&
        join(process.env.PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        join(
          process.env['PROGRAMFILES(X86)'],
          'BraveSoftware',
          'Brave-Browser',
          'Application',
          'brave.exe'
        ),
      process.env.LOCALAPPDATA &&
        join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env.PROGRAMFILES &&
        join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ]

    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ]

    const linuxCandidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
      '/usr/bin/brave-browser'
    ]

    if (process.platform === 'win32') {
      return uniquePaths([DEFAULT_BROWSER_PATH, ...windowsCandidates])
    }

    if (process.platform === 'darwin') {
      return uniquePaths(macCandidates)
    }

    return uniquePaths(linuxCandidates)
  }
}
