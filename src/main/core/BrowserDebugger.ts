import WebSocket from 'ws'
import { logger } from '@main/utils/logger'

interface CdpTargetInfo {
  targetId: string
  type: string
  url?: string
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
  private readonly pageSessions = new Map<string, CdpTargetInfo>()
  private primaryPageSessionId: string | null = null
  private resolvePrimaryPageSession: ((sessionId: string) => void) | null = null
  private readonly primaryPageSessionPromise = new Promise<string>((resolve) => {
    this.resolvePrimaryPageSession = resolve
  })

  public constructor(
    private readonly websocketUrl: string,
    private readonly injectionScript: string,
    private readonly homeUrl: string
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
    const report = await this.collectVerificationReport()

    await this.send('Target.createTarget', {
      url: this.createVerificationPageUrl(report)
    })
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
      await this.installFingerprintScript(sessionId)
    } finally {
      if (waitingForDebugger) {
        await this.runIfWaitingForDebugger(sessionId)
      }
    }
  }

  private handleDetachedFromTarget(params: CdpDetachFromTargetParams): void {
    this.installedSessions.delete(params.sessionId)
    this.pageSessions.delete(params.sessionId)

    if (this.primaryPageSessionId === params.sessionId) {
      const nextPrimary = this.pageSessions.keys().next()
      this.primaryPageSessionId = nextPrimary.done ? null : nextPrimary.value
    }
  }

  private async installFingerprintScript(sessionId: string): Promise<void> {
    if (this.installedSessions.has(sessionId)) {
      return
    }

    await this.send(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: this.injectionScript
      },
      sessionId
    )

    await this.send('Runtime.enable', {}, sessionId).catch(() => undefined)
    await this.send(
      'Runtime.evaluate',
      {
        expression: this.injectionScript
      },
      sessionId
    ).catch(() => undefined)

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
    await this.send(
      'Page.navigate',
      {
        url
      },
      sessionId
    )
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
          const page = {
            href: globalThis.location?.href ?? null,
            title: globalThis.document?.title ?? null,
            readyState: globalThis.document?.readyState ?? null,
            marker: globalThis.document?.documentElement?.getAttribute?.('data-xuss-fingerprint') ?? null,
            profileId: globalThis.document?.documentElement?.getAttribute?.('data-xuss-profile-id') ?? null
          }

          try {
            const report = globalThis.__xussFingerprint?.verify?.()

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
