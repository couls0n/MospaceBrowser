import { EventEmitter } from 'node:events'
import { access, readFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createServer } from 'node:net'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { app } from 'electron'
import { AppSettingsManager } from '@main/core/AppSettingsManager'
import { BrowserDebugger } from '@main/core/BrowserDebugger'
import { ProfileManager } from '@main/core/ProfileManager'
import { logger } from '@main/utils/logger'
import { DEFAULT_PORTS } from '@shared/constants'
import type {
  BrowserInstanceInfo,
  FingerprintConfig,
  LauncherStatusChange,
  Profile
} from '@shared/types'

const execFileAsync = promisify(execFile)

interface ActiveBrowserInstance extends BrowserInstanceInfo {
  process: ChildProcess
  debugger?: BrowserDebugger
}

export class BrowserLauncher extends EventEmitter {
  private static instance: BrowserLauncher | null = null
  private readonly activeInstances = new Map<string, ActiveBrowserInstance>()
  private readonly usedPorts = new Set<number>()
  private readonly settingsManager = AppSettingsManager.getInstance()
  private readonly profileManager = ProfileManager.getInstance()

  public static getInstance(): BrowserLauncher {
    if (!BrowserLauncher.instance) {
      BrowserLauncher.instance = new BrowserLauncher()
    }

    return BrowserLauncher.instance
  }

  private constructor() {
    super()

    app.on('before-quit', () => {
      void this.terminateAll()
    })
  }

  public async launch(profile: Profile): Promise<BrowserInstanceInfo> {
    const running = this.activeInstances.get(profile.id)

    if (running) {
      return this.toPublicInstance(running)
    }

    const browserPath = await this.resolveBrowserPath()
    const debuggingPort = await this.acquirePort()
    const fingerprintConfig = await this.prepareFingerprintConfig(profile)
    const args = this.buildChromiumArgs(profile, debuggingPort, fingerprintConfig)
    const process = spawn(browserPath, args, {
      stdio: 'ignore',
      windowsHide: false
    })

    if (!process.pid) {
      this.releasePort(debuggingPort)
      throw new Error('Chromium failed to start.')
    }

    process.unref()

    try {
      const websocketUrl = await this.waitForDebuggerUrl(debuggingPort)
      const debuggerClient = await this.initializeDebugger(profile, fingerprintConfig, websocketUrl)
      const instance: ActiveBrowserInstance = {
        pid: process.pid,
        profileId: profile.id,
        debuggingPort,
        websocketUrl,
        startTime: Date.now(),
        process,
        debugger: debuggerClient
      }

      this.activeInstances.set(profile.id, instance)
      this.bindProcessLifecycle(profile.id, instance)
      this.emitStatus({
        profileId: profile.id,
        status: 'started',
        data: this.toPublicInstance(instance)
      })

      return this.toPublicInstance(instance)
    } catch (error) {
      this.releasePort(debuggingPort)
      process.kill()
      throw error
    }
  }

  public async terminate(profileId: string): Promise<void> {
    const instance = this.activeInstances.get(profileId)

    if (!instance) {
      return
    }

    await instance.debugger?.close().catch(() => undefined)

    if (process.platform === 'win32') {
      await execFileAsync('taskkill', ['/T', '/F', '/PID', `${instance.pid}`])
    } else {
      process.kill(instance.pid, 'SIGKILL')
    }

    this.activeInstances.delete(profileId)
    this.releasePort(instance.debuggingPort)
    this.emitStatus({
      profileId,
      status: 'stopped'
    })
  }

  public async terminateAll(): Promise<void> {
    const runningProfileIds = Array.from(this.activeInstances.keys())

    for (const profileId of runningProfileIds) {
      await this.terminate(profileId)
    }
  }

  public isRunning(profileId: string): boolean {
    return this.activeInstances.has(profileId)
  }

  public getAllRunning(): BrowserInstanceInfo[] {
    return Array.from(this.activeInstances.values()).map((instance) =>
      this.toPublicInstance(instance)
    )
  }

  public async openVerificationPage(profileId: string): Promise<void> {
    const instance = this.activeInstances.get(profileId)

    if (!instance?.debugger) {
      throw new Error('Profile is not running with an attached debugger session.')
    }

    await instance.debugger.openVerificationPage()
  }

  /**
   * Prepare fingerprint configuration for a profile.
   * Uses the persisted fingerprint when available, otherwise generates one.
   */
  private async prepareFingerprintConfig(profile: Profile): Promise<FingerprintConfig | undefined> {
    if (!profile.fingerprintEnabled) {
      return undefined
    }

    return (
      profile.fingerprintConfig ??
      this.profileManager.generateFingerprint({
        seed: profile.id,
        os: profile.fingerprintOs,
        ip: profile.proxyConfig?.host
      })
    )
  }

  private async resolveBrowserPath(): Promise<string> {
    const browserPath = await this.settingsManager.resolveBrowserExecutablePath()

    try {
      await access(browserPath, fsConstants.F_OK)
      return browserPath
    } catch {
      throw new Error(`Chromium executable not found at ${browserPath}.`)
    }
  }

  private buildChromiumArgs(
    profile: Profile,
    debuggingPort: number,
    fingerprintConfig?: FingerprintConfig
  ): string[] {
    const {
      window: { width, height, pixelRatio },
      locale,
      homeUrl
    } = profile.browserConfig

    const args = [
      `--user-data-dir=${profile.storagePath}`,
      `--remote-debugging-port=${debuggingPort}`,
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${pixelRatio}`,
      `--lang=${fingerprintConfig?.software.locale ?? locale}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      // Anti-detection flags
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-ipc-flooding-protection',
      '--disable-features=Translate'
    ]

    if (fingerprintConfig) {
      args.push(`--user-agent=${fingerprintConfig.userAgent}`)
    }

    if (profile.proxyConfig && profile.proxyConfig.type !== 'none') {
      args.push(
        `--proxy-server=${profile.proxyConfig.type}://${profile.proxyConfig.host}:${profile.proxyConfig.port}`
      )
    }

    args.push(fingerprintConfig ? 'about:blank' : homeUrl)

    return args
  }

  private bindProcessLifecycle(profileId: string, instance: ActiveBrowserInstance): void {
    instance.process.once('exit', (code) => {
      const active = this.activeInstances.get(profileId)

      if (!active) {
        return
      }

      void active.debugger?.close().catch(() => undefined)
      this.activeInstances.delete(profileId)
      this.releasePort(active.debuggingPort)
      this.emitStatus({
        profileId,
        status: code === 0 ? 'stopped' : 'crashed'
      })
    })
  }

  private async acquirePort(): Promise<number> {
    for (let port = DEFAULT_PORTS.DEBUGGER_MIN; port <= DEFAULT_PORTS.DEBUGGER_MAX; port += 1) {
      if (this.usedPorts.has(port)) {
        continue
      }

      if (await this.isPortAvailable(port)) {
        this.usedPorts.add(port)
        return port
      }
    }

    throw new Error('No free remote debugging port is available.')
  }

  private releasePort(port: number): void {
    this.usedPorts.delete(port)
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const server = createServer()

      server.once('error', () => {
        resolve(false)
      })

      server.once('listening', () => {
        server.close(() => resolve(true))
      })

      server.listen(port, '127.0.0.1')
    })
  }

  private async waitForDebuggerUrl(port: number): Promise<string | undefined> {
    const timeoutMs = 15000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`)

        if (response.ok) {
          const payload = (await response.json()) as { webSocketDebuggerUrl?: string }
          return payload.webSocketDebuggerUrl
        }
      } catch {
        // The endpoint is not ready yet.
      }

      await new Promise((resolve) => setTimeout(resolve, 400))
    }

    return undefined
  }

  private emitStatus(event: LauncherStatusChange): void {
    this.emit('statusChange', event)
  }

  private async initializeDebugger(
    profile: Profile,
    fingerprintConfig: FingerprintConfig | undefined,
    websocketUrl: string | undefined
  ): Promise<BrowserDebugger | undefined> {
    if (!fingerprintConfig) {
      return undefined
    }

    if (!websocketUrl) {
      throw new Error('Remote debugging websocket URL was not available for fingerprint injection.')
    }

    const injectionScript = await this.buildInjectionScript(profile.id, fingerprintConfig)
    const debuggerClient = new BrowserDebugger(
      websocketUrl,
      injectionScript,
      profile.browserConfig.homeUrl
    )
    await debuggerClient.initialize()
    logger.info(`Fingerprint injection ready for profile ${profile.id}`)

    return debuggerClient
  }

  private async buildInjectionScript(
    profileId: string,
    fingerprintConfig: FingerprintConfig
  ): Promise<string> {
    const runtimeAssetsRoot = app.isPackaged
      ? join(__dirname, '..')
      : join(process.cwd(), 'src', 'main')
    const injectionScriptPath = join(runtimeAssetsRoot, 'injections', 'fingerprint.js')
    const template = await readFile(injectionScriptPath, 'utf-8')

    return template
      .replace('__XUSS_PROFILE_ID__', JSON.stringify(profileId))
      .replace('__XUSS_FINGERPRINT_CONFIG__', JSON.stringify(fingerprintConfig))
  }

  private toPublicInstance(instance: ActiveBrowserInstance): BrowserInstanceInfo {
    return {
      pid: instance.pid,
      profileId: instance.profileId,
      debuggingPort: instance.debuggingPort,
      websocketUrl: instance.websocketUrl,
      startTime: instance.startTime
    }
  }
}
