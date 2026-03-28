import { Script, createContext } from 'node:vm'
import WebSocket from 'ws'
import { logger } from '@main/utils/logger'
import type {
  BrowserControlExecutionResult,
  BrowserControlLogEntry,
  BrowserControlTab,
  FingerprintConfig
} from '@shared/types'

interface CdpTargetInfo {
  targetId: string
  type: string
  url?: string
  title?: string
}

interface CdpAttachedToTargetParams {
  sessionId: string
  targetInfo: CdpTargetInfo
  waitingForDebugger?: boolean
}

interface CdpDetachFromTargetParams {
  sessionId: string
}

interface CdpErrorPayload {
  message?: string
}

interface CdpTargetListResult {
  targetInfos: CdpTargetInfo[]
}

interface PageNavigateResult {
  frameId?: string
  errorText?: string
}

interface CdpAttachToTargetResult {
  sessionId: string
}

interface RuntimeRemoteObject {
  type?: string
  value?: unknown
  description?: string
}

interface CdpExceptionDetails {
  text?: string
  exception?: {
    description?: string
  }
}

interface RuntimeEvaluateResult {
  result?: RuntimeRemoteObject
  exceptionDetails?: CdpExceptionDetails
}

interface VerificationContextSnapshot {
  href: string | null
  title: string | null
  readyState: string | null
  marker: string | null
  profileId: string | null
}

interface VerificationReport extends Record<string, unknown> {
  applied: boolean
  message?: string
  page?: VerificationContextSnapshot
  sessionId?: string
  checkedAt?: string
}

interface VerificationProbeResult {
  report?: VerificationReport
  message?: string
  page?: VerificationContextSnapshot
}

interface UserAgentMetadataBrand {
  brand: string
  version: string
}

type PendingRequest<TResult> = {
  resolve: (value: TResult) => void
  reject: (error: Error) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export class BrowserDebugger {
  private socket: WebSocket | null = null
  private nextRequestId = 0
  private readonly pendingRequests = new Map<number, PendingRequest<unknown>>()
  private readonly installedSessions = new Set<string>()
  private readonly preparedSessions = new Set<string>()
  private readonly pageSessions = new Map<string, CdpTargetInfo>()
  private primaryPageSessionId: string | null = null
  private resolvePrimaryPageSession: ((sessionId: string) => void) | null = null
  private readonly primaryPageSessionPromise = new Promise<string>((resolve) => {
    this.resolvePrimaryPageSession = resolve
  })

  public constructor(
    private readonly websocketUrl: string,
    private readonly profileId: string,
    private readonly injectionScript: string | undefined,
    private readonly homeUrl: string,
    private readonly fingerprintConfig?: FingerprintConfig
  ) {}

  public async initialize(): Promise<void> {
    await this.connect()
    await this.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })

    const primarySessionId = await this.getOrAttachPrimaryPageSession()
    await this.navigateSession(primarySessionId, this.homeUrl)
  }

  public async openVerificationPage(): Promise<void> {
    if (!this.fingerprintConfig) {
      await this.send('Target.createTarget', {
        url: this.createVerificationPageUrl({
          applied: false,
          message: 'Fingerprint is disabled for this browser profile.',
          checkedAt: new Date().toISOString()
        })
      })

      return
    }

    const report = await this.collectVerificationReport()

    await this.send('Target.createTarget', {
      url: this.createVerificationPageUrl(report)
    })
  }

  public async listControlTabs(): Promise<BrowserControlTab[]> {
    await this.syncAttachedPageSessions()

    const targets = await this.send<CdpTargetListResult>('Target.getTargets')
    const targetMap = new Map(
      targets.targetInfos
        .filter((targetInfo) => targetInfo.type === 'page')
        .map((targetInfo) => [targetInfo.targetId, targetInfo])
    )

    const tabs: Array<BrowserControlTab | null> = await Promise.all(
      Array.from(this.pageSessions.entries()).map(async ([sessionId, targetInfo]) => {
        const latestTargetInfo = targetMap.get(targetInfo.targetId) ?? targetInfo

        if (!this.shouldIncludeControlTab(latestTargetInfo)) {
          return null
        }

        const snapshot = await this.getPageContextSnapshot(sessionId).catch(() => undefined)

        return {
          sessionId,
          targetId: latestTargetInfo.targetId,
          title: snapshot?.title || latestTargetInfo.title || 'Untitled Tab',
          url: snapshot?.href || latestTargetInfo.url || 'about:blank',
          readyState: snapshot?.readyState ?? null,
          isPrimary: sessionId === this.primaryPageSessionId
        } satisfies BrowserControlTab
      })
    )

    return tabs
      .filter((tab): tab is BrowserControlTab => tab !== null)
      .sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) {
          return left.isPrimary ? -1 : 1
        }

        return left.title.localeCompare(right.title)
      })
  }

  public async executeControlScript(input: {
    sessionId?: string
    script: string
    timeoutMs?: number
  }): Promise<BrowserControlExecutionResult> {
    const startedAt = Date.now()
    const logs: BrowserControlLogEntry[] = []
    const timeoutMs = input.timeoutMs ?? 30000
    let tab: BrowserControlTab | undefined

    try {
      const sessionId = await this.resolveControlSessionId(input.sessionId)
      tab = await this.getControlTab(sessionId)

      const context = createContext({
        page: this.createPageAutomationApi(sessionId),
        browser: this.createBrowserAutomationApi(),
        tabs: await this.listControlTabs(),
        console: this.createControlConsole(logs),
        setTimeout,
        clearTimeout,
        URL,
        TextEncoder,
        TextDecoder
      })

      const script = new Script(`(async () => {\n${input.script}\n})()`, {
        filename: `xuss-control-${this.profileId}.js`
      })
      const execution = Promise.resolve(script.runInContext(context) as Promise<unknown>)
      const result = await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Control script timed out after ${timeoutMs}ms.`)), timeoutMs)
        })
      ])

      return {
        success: true,
        tab: await this.getControlTab(sessionId),
        result: this.normalizeControlValue(result),
        logs,
        durationMs: Date.now() - startedAt
      }
    } catch (error) {
      return {
        success: false,
        tab,
        error: error instanceof Error ? error.message : String(error),
        logs,
        durationMs: Date.now() - startedAt
      }
    }
  }

  public async close(): Promise<void> {
    const socket = this.socket
    this.socket = null

    if (!socket) {
      return
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve())
      socket.close()
    })
  }

  private async connect(): Promise<void> {
    if (this.socket) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.websocketUrl)
      let resolved = false

      socket.once('open', () => {
        resolved = true
        this.socket = socket
        resolve()
      })

      socket.once('error', (error) => {
        if (!resolved) {
          reject(error)
          return
        }

        logger.warn('Browser debugger socket error', error)
      })

      socket.on('message', (data) => {
        this.handleMessage(data.toString())
      })

      socket.on('close', () => {
        this.rejectPendingRequests(new Error('Browser debugger connection closed.'))
      })
    })
  }

  private handleMessage(rawMessage: string): void {
    const message = JSON.parse(rawMessage) as {
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      error?: CdpErrorPayload
    }

    if (message.id) {
      const pending = this.pendingRequests.get(message.id)

      if (!pending) {
        return
      }

      this.pendingRequests.delete(message.id)

      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'Unknown CDP error.'))
        return
      }

      pending.resolve(message.result)
      return
    }

    if (message.method === 'Target.attachedToTarget') {
      void this.handleAttachedToTarget(message.params as CdpAttachedToTargetParams)
      return
    }

    if (message.method === 'Target.detachedFromTarget') {
      this.handleDetachedFromTarget(message.params as CdpDetachFromTargetParams)
    }
  }

  private async handleAttachedToTarget(params: CdpAttachedToTargetParams): Promise<void> {
    const { sessionId, targetInfo, waitingForDebugger } = params

    if (targetInfo.type !== 'page') {
      if (waitingForDebugger) {
        await this.runIfWaitingForDebugger(sessionId)
      }

      return
    }

    this.pageSessions.set(sessionId, targetInfo)

    if (!this.primaryPageSessionId) {
      this.primaryPageSessionId = sessionId
      this.resolvePrimaryPageSession?.(sessionId)
      this.resolvePrimaryPageSession = null
    }

    try {
      await this.preparePageSession(sessionId)
      await this.installFingerprintScript(sessionId)
    } finally {
      if (waitingForDebugger) {
        await this.runIfWaitingForDebugger(sessionId)
      }
    }
  }

  private handleDetachedFromTarget(params: CdpDetachFromTargetParams): void {
    this.installedSessions.delete(params.sessionId)
    this.preparedSessions.delete(params.sessionId)
    this.pageSessions.delete(params.sessionId)

    if (this.primaryPageSessionId === params.sessionId) {
      const nextPrimary = this.pageSessions.keys().next()
      this.primaryPageSessionId = nextPrimary.done ? null : nextPrimary.value
    }
  }

  private async installFingerprintScript(sessionId: string): Promise<void> {
    if (!this.injectionScript || this.installedSessions.has(sessionId)) {
      return
    }

    await this.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: this.injectionScript
      },
      sessionId
    )

    this.installedSessions.add(sessionId)
  }

  private async getOrAttachPrimaryPageSession(): Promise<string> {
    if (this.primaryPageSessionId) {
      return this.primaryPageSessionId
    }

    const existingSessionId = await this.waitForPrimaryPageSession(3000)

    if (existingSessionId) {
      return existingSessionId
    }

    const targets = await this.send<CdpTargetListResult>('Target.getTargets')
    const pageTarget = targets.targetInfos.find((targetInfo) => targetInfo.type === 'page')

    if (!pageTarget) {
      throw new Error('No browser page target is available for fingerprint injection.')
    }

    const attachment = await this.send<CdpAttachToTargetResult>('Target.attachToTarget', {
      targetId: pageTarget.targetId,
      flatten: true
    })

    this.pageSessions.set(attachment.sessionId, pageTarget)

    if (!this.primaryPageSessionId) {
      this.primaryPageSessionId = attachment.sessionId
      this.resolvePrimaryPageSession?.(attachment.sessionId)
      this.resolvePrimaryPageSession = null
    }

    await this.preparePageSession(attachment.sessionId)
    await this.installFingerprintScript(attachment.sessionId)

    return attachment.sessionId
  }

  private async waitForPrimaryPageSession(timeoutMs: number): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)

      void this.primaryPageSessionPromise.then((sessionId) => {
        clearTimeout(timer)
        resolve(sessionId)
      })
    })
  }

  private async navigateSession(sessionId: string, url: string): Promise<void> {
    const result = await this.send<PageNavigateResult>(
      'Page.navigate',
      {
        url
      },
      sessionId
    )

    if (result.errorText) {
      throw new Error(result.errorText)
    }
  }

  private async preparePageSession(sessionId: string): Promise<void> {
    if (this.preparedSessions.has(sessionId)) {
      return
    }

    await this.send('Page.enable', {}, sessionId).catch(() => undefined)
    await this.send('Network.enable', {}, sessionId).catch(() => undefined)

    if (this.fingerprintConfig) {
      await this.send(
        'Emulation.setUserAgentOverride',
        this.buildUserAgentOverridePayload(),
        sessionId
      ).catch(() => undefined)
      await this.send(
        'Network.setExtraHTTPHeaders',
        {
          headers: this.buildExtraHttpHeaders()
        },
        sessionId
      ).catch(() => undefined)
      await this.send(
        'Emulation.setLocaleOverride',
        {
          locale: this.fingerprintConfig.software.locale
        },
        sessionId
      ).catch(() => undefined)
      await this.send(
        'Emulation.setTimezoneOverride',
        {
          timezoneId: this.fingerprintConfig.software.timezone
        },
        sessionId
      ).catch(() => undefined)
    }

    this.preparedSessions.add(sessionId)
  }

  private async runIfWaitingForDebugger(sessionId: string): Promise<void> {
    await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined)
  }

  private async collectVerificationReport(): Promise<VerificationReport> {
    const sessionIds = await this.getVerificationCandidateSessionIds()
    let fallback: VerificationProbeResult | null = null

    for (const sessionId of sessionIds) {
      const probe = await this.readVerificationReportFromSession(sessionId)

      if (probe.report) {
        return probe.report
      }

      if (!fallback || probe.page) {
        fallback = probe
      }
    }

    return {
      applied: false,
      message:
        fallback?.message ?? 'Fingerprint helper was not found in any attached browser page.',
      page: fallback?.page,
      checkedAt: new Date().toISOString()
    }
  }

  private async getVerificationCandidateSessionIds(): Promise<string[]> {
    const primarySessionId = await this.getOrAttachPrimaryPageSession()
    const sessionIds = Array.from(new Set([primarySessionId, ...this.pageSessions.keys()]))
    const preferred: string[] = []
    const generated: string[] = []

    for (const sessionId of sessionIds) {
      const targetInfo = this.pageSessions.get(sessionId)

      if (targetInfo?.url?.startsWith('data:')) {
        generated.push(sessionId)
      } else {
        preferred.push(sessionId)
      }
    }

    return [...preferred, ...generated]
  }

  private async readVerificationReportFromSession(
    sessionId: string
  ): Promise<VerificationProbeResult> {
    const evaluation = await this.send<RuntimeEvaluateResult>(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const helper = globalThis[Symbol.for('${this.getHelperSymbolKey()}')]
          const page = {
            href: globalThis.location?.href ?? null,
            title: globalThis.document?.title ?? null,
            readyState: globalThis.document?.readyState ?? null,
            marker: helper ? 'symbol' : null,
            profileId: helper?.profileId ?? null
          }

          try {
            const report = helper?.verify?.()

            if (report) {
              return {
                status: 'ok',
                report,
                page
              }
            }

            return {
              status: 'missing',
              message: 'Fingerprint helper was not found in this page context.',
              page
            }
          } catch (error) {
            return {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
              page
            }
          }
        })()`,
        returnByValue: true,
        awaitPromise: true
      },
      sessionId
    ).catch(
      (error: Error): RuntimeEvaluateResult => ({
        exceptionDetails: {
          text: error.message
        }
      })
    )

    const evaluationError =
      evaluation.exceptionDetails?.exception?.description ?? evaluation.exceptionDetails?.text

    if (evaluationError) {
      return {
        message: evaluationError
      }
    }

    const payload = evaluation.result?.value

    if (!isRecord(payload)) {
      return {
        message: 'Verification returned an unexpected payload.'
      }
    }

    const page = isRecord(payload.page)
      ? ({
          href: typeof payload.page.href === 'string' ? payload.page.href : null,
          title: typeof payload.page.title === 'string' ? payload.page.title : null,
          readyState: typeof payload.page.readyState === 'string' ? payload.page.readyState : null,
          marker: typeof payload.page.marker === 'string' ? payload.page.marker : null,
          profileId: typeof payload.page.profileId === 'string' ? payload.page.profileId : null
        } satisfies VerificationContextSnapshot)
      : undefined

    if (payload.status === 'ok' && isRecord(payload.report)) {
      return {
        report: {
          ...payload.report,
          page,
          sessionId,
          checkedAt: new Date().toISOString()
        } as VerificationReport
      }
    }

    return {
      message:
        typeof payload.message === 'string'
          ? payload.message
          : 'Fingerprint helper was not found in this page context.',
      page
    }
  }

  private async syncAttachedPageSessions(): Promise<void> {
    const targets = await this.send<CdpTargetListResult>('Target.getTargets')
    const attachedTargetIds = new Set(
      Array.from(this.pageSessions.values()).map((targetInfo) => targetInfo.targetId)
    )

    for (const targetInfo of targets.targetInfos) {
      if (targetInfo.type !== 'page' || attachedTargetIds.has(targetInfo.targetId)) {
        continue
      }

      const attachment = await this.send<CdpAttachToTargetResult>('Target.attachToTarget', {
        targetId: targetInfo.targetId,
        flatten: true
      })

      this.pageSessions.set(attachment.sessionId, targetInfo)

      if (!this.primaryPageSessionId) {
        this.primaryPageSessionId = attachment.sessionId
      }

      await this.preparePageSession(attachment.sessionId)
      await this.installFingerprintScript(attachment.sessionId)
    }
  }

  private shouldIncludeControlTab(targetInfo: CdpTargetInfo): boolean {
    const url = targetInfo.url ?? ''
    return targetInfo.type === 'page' && !url.startsWith('data:') && !url.startsWith('devtools://')
  }

  private async getControlTab(sessionId: string): Promise<BrowserControlTab> {
    const tabs = await this.listControlTabs()
    const tab = tabs.find((entry) => entry.sessionId === sessionId)

    if (!tab) {
      throw new Error('The selected browser tab is no longer available.')
    }

    return tab
  }

  private async resolveControlSessionId(sessionId?: string): Promise<string> {
    const tabs = await this.listControlTabs()

    if (sessionId) {
      const matched = tabs.find((entry) => entry.sessionId === sessionId)

      if (!matched) {
        throw new Error('The selected browser tab is not available.')
      }

      return matched.sessionId
    }

    const preferred = tabs.find((entry) => entry.url && entry.url !== 'about:blank') ?? tabs[0]

    if (!preferred) {
      throw new Error('No controllable browser tabs are available.')
    }

    return preferred.sessionId
  }

  private async getPageContextSnapshot(
    sessionId: string
  ): Promise<VerificationContextSnapshot & { title: string | null }> {
    return this.evaluateInSession<VerificationContextSnapshot & { title: string | null }>(
      sessionId,
      `(() => ({
        href: globalThis.location?.href ?? null,
        title: globalThis.document?.title ?? null,
        readyState: globalThis.document?.readyState ?? null,
        marker: null,
        profileId: null
      }))()`
    )
  }

  private async evaluateInSession<TResult>(
    sessionId: string,
    expression: string,
    options: {
      awaitPromise?: boolean
      returnByValue?: boolean
    } = {}
  ): Promise<TResult> {
    const evaluation = await this.send<RuntimeEvaluateResult>(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: options.returnByValue ?? true,
        awaitPromise: options.awaitPromise ?? true
      },
      sessionId
    )

    const evaluationError =
      evaluation.exceptionDetails?.exception?.description ?? evaluation.exceptionDetails?.text

    if (evaluationError) {
      throw new Error(evaluationError)
    }

    return (evaluation.result?.value as TResult) ?? (undefined as TResult)
  }

  private createControlConsole(logs: BrowserControlLogEntry[]) {
    const push = (level: BrowserControlLogEntry['level'], ...values: unknown[]): void => {
      logs.push({
        level,
        message: values.map((value) => this.stringifyControlValue(value)).join(' '),
        timestamp: new Date().toISOString()
      })
    }

    return {
      log: (...values: unknown[]) => push('log', ...values),
      info: (...values: unknown[]) => push('info', ...values),
      warn: (...values: unknown[]) => push('warn', ...values),
      error: (...values: unknown[]) => push('error', ...values)
    }
  }

  private createPageAutomationApi(sessionId: string) {
    return {
      url: async () =>
        this.evaluateInSession<string>(sessionId, 'globalThis.location?.href ?? "about:blank"'),
      title: async () => this.evaluateInSession<string>(sessionId, 'globalThis.document?.title ?? ""'),
      goto: async (url: string) => {
        await this.navigateSession(sessionId, url)
        await this.waitForLoadState(sessionId)
        return this.getControlTab(sessionId)
      },
      reload: async () => {
        await this.send('Page.reload', { ignoreCache: false }, sessionId)
        await this.waitForLoadState(sessionId)
        return this.getControlTab(sessionId)
      },
      waitForTimeout: async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      },
      waitForLoadState: async (state: 'interactive' | 'complete' = 'complete', timeoutMs = 15000) => {
        await this.waitForLoadState(sessionId, state, timeoutMs)
      },
      evaluate: async (script: string | ((arg?: unknown) => unknown), arg?: unknown) => {
        const expression =
          typeof script === 'function'
            ? `(${script.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
            : script

        return this.evaluateInSession<unknown>(sessionId, expression)
      },
      click: async (selector: string) => {
        await this.runDomAction(sessionId, selector, 'click')
      },
      fill: async (selector: string, value: string) => {
        await this.evaluateInSession(
          sessionId,
          `(() => {
            const element = document.querySelector(${JSON.stringify(selector)})
            if (!element) {
              throw new Error('Element not found: ${selector}')
            }
            if (!('value' in element)) {
              throw new Error('Element does not support value assignment: ${selector}')
            }
            element.focus?.()
            element.value = ${JSON.stringify(value)}
            element.dispatchEvent(new Event('input', { bubbles: true }))
            element.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          })()`
        )
      },
      type: async (selector: string, value: string) => {
        await this.evaluateInSession(
          sessionId,
          `(() => {
            const element = document.querySelector(${JSON.stringify(selector)})
            if (!element) {
              throw new Error('Element not found: ${selector}')
            }
            if (!('value' in element)) {
              throw new Error('Element does not support typing: ${selector}')
            }
            element.focus?.()
            element.value = ''
            for (const char of ${JSON.stringify(value)}) {
              element.value += char
              element.dispatchEvent(new Event('input', { bubbles: true }))
            }
            element.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          })()`
        )
      },
      press: async (selector: string, key: string) => {
        await this.evaluateInSession(
          sessionId,
          `(() => {
            const element = document.querySelector(${JSON.stringify(selector)})
            if (!element) {
              throw new Error('Element not found: ${selector}')
            }
            element.focus?.()
            element.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))
            element.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }))
            return true
          })()`
        )
      },
      exists: async (selector: string) =>
        this.evaluateInSession<boolean>(
          sessionId,
          `Boolean(document.querySelector(${JSON.stringify(selector)}))`
        ),
      textContent: async (selector: string) =>
        this.evaluateInSession<string | null>(
          sessionId,
          `(() => document.querySelector(${JSON.stringify(selector)})?.textContent ?? null)()`
        ),
      html: async (selector: string) =>
        this.evaluateInSession<string | null>(
          sessionId,
          `(() => document.querySelector(${JSON.stringify(selector)})?.innerHTML ?? null)()`
        ),
      waitForSelector: async (
        selector: string,
        options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }
      ) => {
        await this.waitForSelector(sessionId, selector, options)
      }
    }
  }

  private createBrowserAutomationApi() {
    return {
      tabs: async () => this.listControlTabs(),
      activateTab: async (sessionId: string) => {
        const targetInfo = this.pageSessions.get(sessionId)

        if (!targetInfo) {
          throw new Error('Tab session not found.')
        }

        await this.send('Target.activateTarget', { targetId: targetInfo.targetId })
        return this.getControlTab(sessionId)
      },
      newTab: async (url = 'about:blank') => {
        const created = await this.send<{ targetId: string }>('Target.createTarget', { url })
        await this.syncAttachedPageSessions()
        const tab = (await this.listControlTabs()).find((entry) => entry.targetId === created.targetId)

        if (!tab) {
          throw new Error('The newly created tab could not be attached.')
        }

        return tab
      }
    }
  }

  private async runDomAction(sessionId: string, selector: string, action: 'click'): Promise<void> {
    await this.evaluateInSession(
      sessionId,
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)})
        if (!element) {
          throw new Error('Element not found: ${selector}')
        }
        element.focus?.()
        element.${action}()
        return true
      })()`
    )
  }

  private async waitForLoadState(
    sessionId: string,
    targetState: 'interactive' | 'complete' = 'complete',
    timeoutMs = 15000
  ): Promise<void> {
    const allowedStates = targetState === 'interactive' ? ['interactive', 'complete'] : ['complete']
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const readyState = await this.evaluateInSession<string | null>(
        sessionId,
        'globalThis.document?.readyState ?? null'
      ).catch(() => null)

      if (readyState && allowedStates.includes(readyState)) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    throw new Error(`Page did not reach "${targetState}" within ${timeoutMs}ms.`)
  }

  private async waitForSelector(
    sessionId: string,
    selector: string,
    options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }
  ): Promise<void> {
    const timeoutMs = options?.timeout ?? 10000
    const state = options?.state ?? 'visible'
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const matched = await this.evaluateInSession<boolean>(
        sessionId,
        `(() => {
          const element = document.querySelector(${JSON.stringify(selector)})

          switch (${JSON.stringify(state)}) {
            case 'attached':
              return Boolean(element)
            case 'detached':
              return !element
            case 'hidden':
              if (!element) {
                return true
              }
              const hiddenStyle = getComputedStyle(element)
              const hiddenRect = element.getBoundingClientRect()
              return hiddenStyle.display === 'none' || hiddenStyle.visibility === 'hidden' || hiddenRect.width === 0 || hiddenRect.height === 0
            case 'visible':
            default:
              if (!element) {
                return false
              }
              const style = getComputedStyle(element)
              const rect = element.getBoundingClientRect()
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          }
        })()`
      ).catch(() => false)

      if (matched) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    throw new Error(`Selector "${selector}" was not ${state} within ${timeoutMs}ms.`)
  }

  private normalizeControlValue(value: unknown): unknown {
    try {
      return structuredClone(value)
    } catch {
      return this.stringifyControlValue(value)
    }
  }

  private stringifyControlValue(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }

    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  private buildUserAgentOverridePayload(): Record<string, unknown> {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      throw new Error('Fingerprint configuration is not available for this browser session.')
    }

    return {
      userAgent: fingerprintConfig.userAgent,
      acceptLanguage: this.buildAcceptLanguageHeader(),
      platform: this.getClientHintPlatform(),
      userAgentMetadata: this.buildUserAgentMetadata()
    }
  }

  private buildUserAgentMetadata(): Record<string, unknown> {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      throw new Error('Fingerprint configuration is not available for this browser session.')
    }

    const fullVersion = this.extractBrowserVersion(fingerprintConfig.userAgent) ?? '142.0.7444.175'
    const brands = this.parseSecChUaBrands(fingerprintConfig.secChUa, false)
    const fullVersionList = this.parseSecChUaBrands(fingerprintConfig.secChUa, true)
    const architecture = this.getArchitecture()
    const bitness = architecture === 'arm' ? '64' : this.getBitness()

    return {
      brands,
      fullVersionList,
      fullVersion,
      platform: this.getClientHintPlatform(),
      platformVersion: this.getClientHintPlatformVersion(),
      architecture,
      model: '',
      mobile: false,
      bitness,
      wow64: false
    }
  }

  private parseSecChUaBrands(secChUa: string | undefined, useFullVersion: boolean): UserAgentMetadataBrand[] {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      throw new Error('Fingerprint configuration is not available for this browser session.')
    }

    const fullVersion = this.extractBrowserVersion(fingerprintConfig.userAgent) ?? '142.0.7444.175'
    const majorVersion = fullVersion.split('.')[0] || '142'
    const matcher = /"([^"]+)"\s*;\s*v="([^"]+)"/g
    const brands: UserAgentMetadataBrand[] = []
    let match = matcher.exec(secChUa ?? '')

    while (match) {
      const brand = match[1]
      const version = this.isGreaseBrand(brand)
        ? useFullVersion
          ? '8.0.0.0'
          : '8'
        : useFullVersion
          ? fullVersion
          : majorVersion

      brands.push({ brand, version })
      match = matcher.exec(secChUa ?? '')
    }

    if (brands.length) {
      return brands
    }

    return [
      { brand: 'Not_A Brand', version: useFullVersion ? '8.0.0.0' : '8' },
      { brand: 'Chromium', version: useFullVersion ? fullVersion : majorVersion },
      { brand: this.getBrowserBrand(), version: useFullVersion ? fullVersion : majorVersion }
    ]
  }

  private buildExtraHttpHeaders(): Record<string, string> {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      return {}
    }

    const headers: Record<string, string> = {
      'Accept-Language': this.buildAcceptLanguageHeader()
    }

    if (fingerprintConfig.software.doNotTrack) {
      headers.DNT = '1'
    }

    return headers
  }

  private buildAcceptLanguageHeader(): string {
    const languages = this.buildLanguages()
    return languages
      .map((language, index) => {
        if (index === 0) {
          return language
        }

        const q = Math.max(0.1, 1 - index * 0.1)
        return `${language};q=${q.toFixed(1)}`
      })
      .join(', ')
  }

  private buildLanguages(): string[] {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      return ['en-US', 'en']
    }

    const primary = fingerprintConfig.software.locale
    const languagePart = primary.split('-')[0]
    const candidates = [primary, languagePart, 'en-US', 'en']
    return Array.from(new Set(candidates.filter((value) => value && value.length >= 2)))
  }

  private getBrowserBrand(): string {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      return 'Google Chrome'
    }

    const secChUa = fingerprintConfig.secChUa ?? ''
    const matcher = /"([^"]+)"\s*;\s*v="([^"]+)"/g
    let match = matcher.exec(secChUa)

    while (match) {
      const brand = match[1]
      if (!this.isGreaseBrand(brand) && brand !== 'Chromium') {
        return brand
      }

      match = matcher.exec(secChUa)
    }

    if (fingerprintConfig.userAgent.includes('Edg/')) {
      return 'Microsoft Edge'
    }

    if (fingerprintConfig.userAgent.includes('OPR/')) {
      return 'Opera'
    }

    if (fingerprintConfig.userAgent.includes('Vivaldi/')) {
      return 'Vivaldi'
    }

    return 'Google Chrome'
  }

  private getClientHintPlatform(): string {
    const fingerprintConfig = this.fingerprintConfig

    if (!fingerprintConfig) {
      return 'Windows'
    }

    if (fingerprintConfig.software.platform === 'MacIntel') {
      return 'macOS'
    }

    if (fingerprintConfig.software.platform.includes('Linux')) {
      return 'Linux'
    }

    return 'Windows'
  }

  private getClientHintPlatformVersion(): string {
    const fingerprintConfig = this.fingerprintConfig
    const platform = this.getClientHintPlatform()

    if (platform === 'Linux') {
      return '6.14.0'
    }

    if (platform === 'macOS') {
      return '15.5.0'
    }

    return fingerprintConfig?.userAgent.includes('Windows NT 10.0') ? '15.0.0' : '10.0.0'
  }

  private getArchitecture(): string {
    const fingerprintConfig = this.fingerprintConfig

    if (fingerprintConfig && /arm|aarch64/i.test(fingerprintConfig.userAgent)) {
      return 'arm'
    }

    return 'x86'
  }

  private getBitness(): string {
    return this.fingerprintConfig && /x64|Win64|x86_64/i.test(this.fingerprintConfig.userAgent)
      ? '64'
      : '32'
  }

  private extractBrowserVersion(userAgent: string): string | null {
    const match = userAgent.match(/(?:Chrome|Edg|OPR|Vivaldi)\/([\d.]+)/)
    return match?.[1] ?? null
  }

  private isGreaseBrand(brand: string): boolean {
    const normalized = brand.toLowerCase()
    return normalized.includes('not') && normalized.includes('brand')
  }

  private getHelperSymbolKey(): string {
    return `__xuss.fingerprint.${this.profileId}`
  }

  private async send<TResult>(
    method: string,
    params?: unknown,
    sessionId?: string
  ): Promise<TResult> {
    const socket = this.socket

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Browser debugger is not connected.')
    }

    const id = ++this.nextRequestId
    const payload = {
      id,
      method,
      params,
      sessionId
    }

    const responsePromise = new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject
      } as PendingRequest<unknown>)
    })

    socket.send(JSON.stringify(payload))

    return responsePromise
  }

  private rejectPendingRequests(error: Error): void {
    const requests = Array.from(this.pendingRequests.values())
    this.pendingRequests.clear()

    requests.forEach((pending) => pending.reject(error))
  }

  private createVerificationPageUrl(report: VerificationReport): string {
    const reportPayload = encodeURIComponent(JSON.stringify(report))
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>XussBrowser Fingerprint Verification</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: "Segoe UI", system-ui, sans-serif;
      }

      body {
        margin: 0;
        padding: 32px;
        background: linear-gradient(180deg, #f7fbff 0%, #eef5ff 100%);
        color: #172033;
      }

      .card {
        max-width: 980px;
        margin: 0 auto;
        padding: 24px;
        background: rgba(255, 255, 255, 0.92);
        border: 1px solid rgba(34, 74, 143, 0.12);
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(19, 41, 80, 0.12);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.15;
      }

      p {
        margin: 0 0 16px;
        line-height: 1.6;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 14px;
        margin: 24px 0;
      }

      .summary-card {
        padding: 16px 18px;
        border-radius: 14px;
        background: #f8fbff;
        border: 1px solid rgba(34, 74, 143, 0.12);
      }

      .summary-card span {
        display: block;
        margin-bottom: 8px;
        color: #5b6b86;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .summary-card strong {
        font-size: 18px;
      }

      .status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-weight: 700;
      }

      .status--ok {
        background: #dcfce7;
        color: #166534;
      }

      .status--error {
        background: #fee2e2;
        color: #b91c1c;
      }

      .message {
        margin-bottom: 18px;
        padding: 14px 16px;
        border-radius: 14px;
        background: #fff7ed;
        color: #9a3412;
        border: 1px solid #fed7aa;
      }

      .checks {
        display: grid;
        gap: 10px;
        margin-bottom: 24px;
      }

      .check {
        display: grid;
        grid-template-columns: 160px 1fr 1fr 100px;
        gap: 12px;
        align-items: start;
        padding: 14px 16px;
        border-radius: 14px;
        background: #ffffff;
        border: 1px solid rgba(34, 74, 143, 0.1);
      }

      .check__label {
        font-weight: 700;
      }

      .check__value {
        min-width: 0;
        font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .pill {
        justify-self: end;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 72px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
      }

      .pill--pass {
        background: #dcfce7;
        color: #166534;
      }

      .pill--fail {
        background: #fee2e2;
        color: #b91c1c;
      }

      .pill--na {
        background: #e2e8f0;
        color: #334155;
      }

      pre {
        margin: 0;
        padding: 16px;
        overflow: auto;
        border-radius: 14px;
        background: #0f172a;
        color: #dbeafe;
        font-size: 13px;
        line-height: 1.5;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        padding: 8px 12px;
        border-radius: 999px;
        background: #dbeafe;
        color: #1d4ed8;
        font-weight: 700;
      }

      @media (max-width: 860px) {
        body {
          padding: 18px;
        }

        .card {
          padding: 18px;
        }

        .check {
          grid-template-columns: 1fr;
        }

        .pill {
          justify-self: start;
        }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">Injected Fingerprint Check</div>
      <h1>XussBrowser Verification</h1>
      <p>This report is captured from the live browser page context and rendered here as a standalone snapshot.</p>
      <div id="status"></div>
      <div id="message"></div>
      <div id="summary" class="summary"></div>
      <div id="checks" class="checks"></div>
      <pre id="report"></pre>
    </div>
    <script>
      const report = JSON.parse(decodeURIComponent('${reportPayload}'));

      function stableStringify(value) {
        if (value === undefined) {
          return 'undefined';
        }

        if (value === null) {
          return 'null';
        }

        if (typeof value === 'string') {
          return value;
        }

        try {
          return JSON.stringify(value, null, 2);
        } catch (_error) {
          return String(value);
        }
      }

      function isEqual(expected, observed) {
        return stableStringify(expected) === stableStringify(observed);
      }

      const expected = report.expected ?? {};
      const observed = report.observed ?? {};
      const checks = [
        ['User Agent', expected.userAgent, observed.userAgent],
        ['Platform', expected.platform, observed.platform],
        ['Locale', expected.locale, observed.locale],
        ['Languages', expected.languages, observed.languages],
        ['Timezone', expected.timezone, observed.timezone],
        ['CPU Cores', expected.cpuCores, observed.cpuCores],
        ['Memory', expected.memory, observed.memory],
        ['Screen', expected.screen, observed.screen],
        ['GPU', expected.gpu, observed.gpu],
        ['Do Not Track', expected.doNotTrack, observed.doNotTrack]
      ];

      const statusNode = document.getElementById('status');
      const messageNode = document.getElementById('message');
      const summaryNode = document.getElementById('summary');
      const checksNode = document.getElementById('checks');
      const rawNode = document.getElementById('report');

      const statusClass = report.applied ? 'status status--ok' : 'status status--error';
      const statusText = report.applied ? 'Injection detected' : 'Injection missing';
      statusNode.innerHTML = '<div class="' + statusClass + '">' + statusText + '</div>';

      if (report.message) {
        messageNode.innerHTML = '<div class="message">' + report.message + '</div>';
      }

      const passCount = checks.filter(([, exp, obs]) => exp !== undefined && isEqual(exp, obs)).length;
      const comparableCount = checks.filter(([, exp]) => exp !== undefined).length;
      const pageHref = report.page?.href ?? 'Unknown';
      const checkedAt = report.checkedAt ? new Date(report.checkedAt).toLocaleString() : 'Unknown';

      summaryNode.innerHTML = [
        ['Profile', report.profileId ?? report.page?.profileId ?? 'Unknown'],
        ['Page URL', pageHref],
        ['Matched Checks', passCount + ' / ' + comparableCount],
        ['Checked At', checkedAt]
      ].map(([label, value]) => (
        '<div class="summary-card"><span>' + label + '</span><strong>' + stableStringify(value) + '</strong></div>'
      )).join('');

      checksNode.innerHTML = checks.map(([label, exp, obs]) => {
        const comparable = exp !== undefined;
        const passed = comparable && isEqual(exp, obs);
        const pillClass = comparable ? (passed ? 'pill pill--pass' : 'pill pill--fail') : 'pill pill--na';
        const pillText = comparable ? (passed ? 'PASS' : 'FAIL') : 'N/A';

        return [
          '<div class="check">',
          '<div class="check__label">' + label + '</div>',
          '<div class="check__value">' + stableStringify(exp) + '</div>',
          '<div class="check__value">' + stableStringify(obs) + '</div>',
          '<div class="' + pillClass + '">' + pillText + '</div>',
          '</div>'
        ].join('');
      }).join('');

      rawNode.textContent = JSON.stringify(report, null, 2);
    </script>
  </body>
</html>`

    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  }
}
