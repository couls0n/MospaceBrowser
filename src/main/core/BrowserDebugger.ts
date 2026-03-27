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

type PendingRequest<TResult> = {
  resolve: (value: TResult) => void
  reject: (error: Error) => void
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
    await this.send('Target.createTarget', {
      url: this.createVerificationPageUrl()
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

  private createVerificationPageUrl(): string {
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
      }

      p {
        margin: 0 0 16px;
        line-height: 1.6;
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
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">Injected Fingerprint Check</div>
      <h1>XussBrowser Verification</h1>
      <p>This page reads the injected fingerprint state directly from the browser page context.</p>
      <pre id="report">Loading...</pre>
    </div>
    <script>
      const report = window.__xussFingerprint?.verify?.() ?? {
        applied: false,
        message: 'Fingerprint helper was not found in the page context.'
      };

      document.getElementById('report').textContent = JSON.stringify(report, null, 2);
    </script>
  </body>
</html>`

    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  }
}
