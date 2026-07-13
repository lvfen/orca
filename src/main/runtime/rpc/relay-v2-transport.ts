import type { WebSocket } from 'ws'
import { RelayCloseCode } from '../../../shared/relay-protocol'
import {
  RELAY_V2_PROTOCOL_VERSION,
  encodeRelayV2ClientMessage,
  parseRelayV2ServerMessage,
  type RelayV2ServerMessage
} from '../../../shared/relay-v2-protocol'
import type { CreateInviteResult, DesktopRelayV2Status } from '../../../shared/relay-v2-desktop'
import type { MobileTransport, RpcTransport } from './transport'
import { relayV2InviteUnavailableResult } from './relay-v2-invite-precheck'
import { RelayV2InviteRequests } from './relay-v2-invite-requests'
import {
  isRelayV2CertificateError,
  mobileStateToSummary,
  noopRelayV2Reply,
  rawRelayV2DataToBytes,
  rawRelayV2DataToString
} from './relay-v2-transport-frames'
import type {
  RelayV2CloseHandler,
  RelayV2MessageHandler,
  RelayV2TransportOptions
} from './relay-v2-transport-types'
import { RelayV2TransportKeepalive } from './relay-v2-transport-keepalive'
import { openRelayV2WebSocket } from './relay-v2-websocket-factory'

export type { RelayV2TransportOptions } from './relay-v2-transport-types'

const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000]
const CONNECT_TIMEOUT_MS = 12_000
const KEEPALIVE_INTERVAL_MS = 20_000
const INVITE_TIMEOUT_MS = 10_000

export class RelayV2Transport implements RpcTransport, MobileTransport {
  private readonly relayUrl: string
  private readonly pcId: string
  private readonly pcName: string
  private readonly pcSecret: string
  private readonly accessToken: string
  private readonly publicKeyB64: string
  private readonly serverCaDerB64: string | null
  private readonly reconnectDelaysMs: number[]
  private readonly connectTimeoutMs: number
  private readonly keepalive: RelayV2TransportKeepalive
  private readonly inviteRequests: RelayV2InviteRequests
  private messageHandler: RelayV2MessageHandler | null = null
  private closeHandler: RelayV2CloseHandler | null = null
  private currentWs: WebSocket | null = null
  private readonly clientIds = new Map<WebSocket, string>()
  private readonly statusListeners = new Set<(status: DesktopRelayV2Status) => void>()
  private intentionallyClosed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private lastSocketCertificateError = false
  private status: DesktopRelayV2Status

  constructor(options: RelayV2TransportOptions) {
    this.relayUrl = options.relayUrl
    this.pcId = options.pcId
    this.pcName = options.pcName
    this.pcSecret = options.pcSecret
    this.accessToken = options.accessToken
    this.publicKeyB64 = options.publicKeyB64
    this.serverCaDerB64 = options.serverCaDerB64 ?? null
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.keepalive = new RelayV2TransportKeepalive(
      options.keepaliveIntervalMs ?? KEEPALIVE_INTERVAL_MS
    )
    this.inviteRequests = new RelayV2InviteRequests(options.inviteTimeoutMs ?? INVITE_TIMEOUT_MS)
    this.status = this.buildStatus('idle')
  }

  onMessage(handler: RelayV2MessageHandler): void {
    this.messageHandler = handler
  }

  onConnectionClose(handler: RelayV2CloseHandler): void {
    this.closeHandler = handler
  }

  setClientId(ws: WebSocket, clientId: string): void {
    this.clientIds.set(ws, clientId)
  }

  getStatus(): DesktopRelayV2Status {
    return this.status
  }

  onStatusChange(listener: (status: DesktopRelayV2Status) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  async start(): Promise<void> {
    this.intentionallyClosed = false
    this.openConnection()
  }

  async stop(): Promise<void> {
    this.intentionallyClosed = true
    this.clearTimers()
    this.inviteRequests.reject('not-connected', this.status)
    const ws = this.currentWs
    this.currentWs = null
    if (ws) {
      ws.close()
    }
    this.setStatus(this.buildStatus('idle', { mobile: null, channelId: null, lastError: null }))
  }

  createInvite(mode: 'keep-existing' | 'disconnect-existing'): Promise<CreateInviteResult> {
    const ws = this.currentWs
    const unavailable = relayV2InviteUnavailableResult({
      hasPendingInvite: this.inviteRequests.hasPending(),
      status: this.status,
      ws
    })
    if (unavailable) {
      return Promise.resolve(unavailable)
    }
    return this.inviteRequests.create(ws!, mode, this.status)
  }

  private openConnection(): void {
    if (this.intentionallyClosed) {
      return
    }
    this.lastSocketCertificateError = false
    this.setStatus(
      this.buildStatus(this.reconnectAttempt > 0 ? 'relay-unavailable' : 'connecting', {
        attempt: this.reconnectAttempt,
        mobile: null,
        lastError: null
      })
    )

    const ws = openRelayV2WebSocket(this.relayUrl, this.serverCaDerB64)
    this.currentWs = ws
    ws.on('error', (error) => {
      if (isRelayV2CertificateError(error)) {
        this.lastSocketCertificateError = true
      }
    })

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (ws === this.currentWs && ws.readyState === ws.CONNECTING) {
        ws.terminate()
      }
    }, this.connectTimeoutMs)
    if (typeof this.connectTimer.unref === 'function') {
      this.connectTimer.unref()
    }

    ws.on('open', () => {
      if (ws !== this.currentWs) {
        return
      }
      this.clearConnectTimer()
      this.keepalive.start(ws, () => this.currentWs)
      ws.send(
        encodeRelayV2ClientMessage({
          type: 'pc-hello',
          v: RELAY_V2_PROTOCOL_VERSION,
          pcId: this.pcId,
          pcName: this.pcName,
          pcSecret: this.pcSecret,
          publicKeyB64: this.publicKeyB64,
          accessToken: this.accessToken
        })
      )
    })
    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (ws !== this.currentWs) {
        return
      }
      this.handleSocketMessage(ws, data, isBinary)
    })
    ws.on('close', (code: number) => {
      if (ws !== this.currentWs) {
        return
      }
      this.handleSocketClosed(ws, code)
    })
  }

  private handleSocketMessage(ws: WebSocket, data: WebSocket.RawData, isBinary: boolean): void {
    if (!isBinary) {
      const text = rawRelayV2DataToString(data)
      const control = parseRelayV2ServerMessage(text)
      if (control) {
        this.handleControlFrame(control)
        return
      }
      this.messageHandler?.(text, noopRelayV2Reply, ws)
      return
    }
    this.messageHandler?.(rawRelayV2DataToBytes(data), noopRelayV2Reply, ws)
  }

  private handleControlFrame(message: RelayV2ServerMessage): void {
    switch (message.type) {
      case 'pc-hello-ack':
        this.reconnectAttempt = 0
        this.setStatus(
          this.buildStatus('connected', {
            attempt: 0,
            mobile: message.mobile,
            lastError: null
          })
        )
        return
      case 'channel-created':
        this.setStatus(this.buildStatus('connected', { channelId: message.channelId }))
        this.inviteRequests.resolveCreated(message, this.status)
        return
      case 'channel-create-requires-confirmation':
        this.inviteRequests.resolveConfirmationRequired(message, this.status)
        return
      case 'mobile-state':
        this.setStatus(
          this.buildStatus('connected', {
            mobile: mobileStateToSummary(message, this.status.mobile)
          })
        )
        return
      case 'mobile-bind-ack':
      case 'mobile-resume-ack':
        break
    }
  }

  private handleSocketClosed(ws: WebSocket, code: number): void {
    this.clearConnectTimer()
    this.keepalive.clear()
    this.currentWs = null
    this.inviteRequests.reject('not-connected', this.status)
    const clientId = this.clientIds.get(ws) ?? null
    this.clientIds.delete(ws)
    this.closeHandler?.(clientId, ws, false)

    if (this.intentionallyClosed) {
      this.setStatus(this.buildStatus('idle', { mobile: null, channelId: null, lastError: null }))
      return
    }
    if (this.lastSocketCertificateError) {
      this.setStatus(
        this.buildStatus('certificate-required', { lastError: 'certificate-required' })
      )
      return
    }
    if (code === RelayCloseCode.Unauthorized || code === RelayCloseCode.BadJoin) {
      this.setStatus(this.buildStatus('unauthorized', { lastError: 'unauthorized' }))
      return
    }
    if (code === RelayCloseCode.Occupied) {
      this.setStatus(this.buildStatus('relay-unavailable', { lastError: 'pc-occupied' }))
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    const delay =
      this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)]!
    this.reconnectAttempt += 1
    this.setStatus(
      this.buildStatus('relay-unavailable', {
        attempt: this.reconnectAttempt,
        mobile: null,
        lastError: 'relay-unavailable'
      })
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openConnection()
    }, delay)
    if (typeof this.reconnectTimer.unref === 'function') {
      this.reconnectTimer.unref()
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  }

  private clearTimers(): void {
    this.clearConnectTimer()
    this.keepalive.clear()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private buildStatus(
    state: DesktopRelayV2Status['state'],
    overrides: Partial<DesktopRelayV2Status> = {}
  ): DesktopRelayV2Status {
    return {
      state,
      relayUrl: this.relayUrl,
      pcId: this.pcId,
      pcName: this.pcName,
      attempt: this.reconnectAttempt,
      mobile: this.status?.mobile ?? null,
      channelId: this.status?.channelId ?? null,
      lastError: this.status?.lastError ?? null,
      ...overrides
    }
  }

  private setStatus(status: DesktopRelayV2Status): void {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}
