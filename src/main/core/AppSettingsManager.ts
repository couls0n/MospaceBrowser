import { constants as fsConstants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { DEFAULT_BROWSER_PATH } from '@shared/constants'
import type { AppSettings, BrowserExecutablePathInfo } from '@shared/types'
import { getAppPaths } from '@main/utils/paths'

function normalizePath(path?: string): string | undefined {
  const normalized = path?.trim()
  return normalized ? normalized : undefined
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

    if (envPath) {
      return {
        configuredPath: settings.browserExecutablePath,
        resolvedPath: envPath,
        source: 'environment'
      }
    }

    if (settings.browserExecutablePath) {
      return {
        configuredPath: settings.browserExecutablePath,
        resolvedPath: settings.browserExecutablePath,
        source: 'settings'
      }
    }

    return {
      configuredPath: undefined,
      resolvedPath: DEFAULT_BROWSER_PATH,
      source: 'default'
    }
  }

  public async resolveBrowserExecutablePath(): Promise<string> {
    const browserPathInfo = await this.getBrowserExecutablePathInfo()
    return browserPathInfo.resolvedPath
  }
}
