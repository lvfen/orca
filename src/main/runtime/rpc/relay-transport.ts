// Why: the relay transport opens ONE outbound host socket to the relay bridge
// and keeps it waiting. It exposes the same onMessage/onConnectionClose/
// setClientId shape as the LAN WebSocketTransport (the MobileTransport contract)
// so OrcaRuntimeRpcServer reuses its E2EE/dispatch wiring unchanged — one socket
// ⇒ one connection ⇒ one E2EEChannel, identical to an accepted LAN ws. The relay
// is a dumb pipe: this transport just strips the relay's plaintext control
// frames and forwards everything else (opaque E2EE ciphertext) to that wiring.
import { WebSocket } from 'ws'
import {
  RelayCloseCode,
  encodeHostJoin,
  parseRelayControlFrame,
  type RelayStatus
} from '../../../shared/relay-protocol'
import { decodePcToken } from '../../../shared/relay-token'
import type { MobileTransport, MobileTransportMessage, RpcTransport } from './transport'

export type { RelayStatus } from '../../../shared/relay-protocol'

// Why: mirror the mobile client's tiered backoff (rpc-client.ts). The desktop
// host keeps retrying indefinitely (it must hold the host slot open) but the
// delay is capped at the last entry so a long-unreachable relay isn't hammered.
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000]
const CONNECT_TIMEOUT_MS = 12_000

type MessageHandler = (
  msg: MobileTransportMessage,
  reply: (response: string) => void,
  ws: WebSocket
) => void
type CloseHandler = (clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void

export type RelayTransportOptions = {
  pcToken: string
  // Why: test-only overrides.
  reconnectDelaysMs?: number[]
  connectTimeoutMs?: number
}

export class RelayTransport implements RpcTransport, MobileTransport {
  private readonly pcToken: string
  private readonly relayUrl: string | null
  private readonly reconnectDelaysMs: number[]
  private readonly connectTimeoutMs: number
  private messageHandler: MessageHandler | null = null
  private closeHandler: CloseHandler | null = null
  private currentWs: WebSocket | null = null
  // Why: a socket may be superseded mid-flight; track the clientId per ws so a
  // late close still reports the right device to the runtime teardown.
  private readonly clientIds = new Map<WebSocket, string>()
  // Why: a host socket carries exactly one phone session. A SECOND peer-online
  // on the same socket means a new phone took the client slot, so we recycle
  // this socket to force a fresh E2EE session rather than feeding a new
  // e2ee_hello into the stale channel.
  private pairedOnce = false
  private intentionallyClosed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private status: RelayStatus = { state: 'disconnected', attempt: 0, phoneOnline: false }
  private readonly statusListeners = new Set<(status: RelayStatus) => void>()

  constructor(options: RelayTransportOptions) {
    this.pcToken = options.pcToken
    this.relayUrl = decodePcToken(options.pcToken)?.payload.relayUrl ?? null
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  onConnectionClose(handler: CloseHandler): void {
    this.closeHandler = handler
  }

  setClientId(ws: WebSocket, clientId: string): void {
    this.clientIds.set(ws, clientId)
  }

  // Why: revocation parity with WebSocketTransport. If the relay device token is
  // revoked, drop the live session; the host socket recycles and waits again.
  terminateClientConnections(clientId: string): number {
    if (this.currentWs && this.clientIds.get(this.currentWs) === clientId) {
      this.currentWs.close()
      return 1
    }
    return 0
  }

  getStatus(): RelayStatus {
    return this.status
  }

  onStatusChange(listener: (status: RelayStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  async start(): Promise<void> {
    this.intentionallyClosed = false
    if (!this.relayUrl) {
      this.setStatus({ state: 'unauthorized', attempt: 0, phoneOnline: false })
      return
    }
    this.openConnection()
  }

  async stop(): Promise<void> {
    this.intentionallyClosed = true
    this.clearTimers()
    const ws = this.currentWs
    this.currentWs = null
    if (ws) {
      ws.close()
    }
    this.setStatus({ state: 'disconnected', attempt: 0, phoneOnline: false })
  }

  private openConnection(): void {
    if (this.intentionallyClosed || !this.relayUrl) {
      return
    }
    this.setStatus({
      state: this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
      attempt: this.reconnectAttempt,
      phoneOnline: false
    })
    this.pairedOnce = false

    const ws = new WebSocket(this.relayUrl)
    this.currentWs = ws
    // Why: prevent an unhandled 'error' from throwing; the close handler runs
    // right after and drives the reconnect.
    ws.on('error', () => {})

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
      ws.send(encodeHostJoin(this.pcToken))
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
      const text = rawDataToString(data)
      const control = parseRelayControlFrame(text)
      if (control) {
        this.handleControlFrame(ws, control.type)
        return
      }
      this.messageHandler?.(text, noopReply, ws)
      return
    }
    this.messageHandler?.(rawDataToBytes(data), noopReply, ws)
  }

  private handleControlFrame(ws: WebSocket, type: string): void {
    if (type === 'host-join-ack') {
      this.reconnectAttempt = 0
      this.setStatus({ state: 'connected', attempt: 0, phoneOnline: this.status.phoneOnline })
      return
    }
    if (type === 'peer-online') {
      if (this.pairedOnce) {
        // Second phone session on this socket — recycle to get a fresh channel.
        ws.close()
        return
      }
      this.pairedOnce = true
      this.setStatus({ state: 'connected', attempt: 0, phoneOnline: true })
    }
    // host-offline / room-ready are client-only; the host ignores them.
  }

  private handleSocketClosed(ws: WebSocket, code: number): void {
    this.clearConnectTimer()
    this.currentWs = null
    const clientId = this.clientIds.get(ws) ?? null
    this.clientIds.delete(ws)
    // Why: always tell the runtime this socket closed so it disposes the
    // per-ws E2EEChannel + abort state. A fresh socket gets a fresh channel.
    this.closeHandler?.(clientId, ws, false)

    if (this.intentionallyClosed) {
      this.setStatus({ state: 'disconnected', attempt: 0, phoneOnline: false })
      return
    }
    if (code === RelayCloseCode.Occupied) {
      this.setStatus({ state: 'occupied', attempt: this.reconnectAttempt, phoneOnline: false })
      return
    }
    if (code === RelayCloseCode.Unauthorized) {
      this.setStatus({ state: 'unauthorized', attempt: this.reconnectAttempt, phoneOnline: false })
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    const delay =
      this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)]!
    this.reconnectAttempt += 1
    this.setStatus({ state: 'reconnecting', attempt: this.reconnectAttempt, phoneOnline: false })
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setStatus(status: RelayStatus): void {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }
}

const noopReply = (): void => {}

function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') {
    return data
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf-8')
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf-8')
  }
  return data.toString('utf-8')
}

function rawDataToBytes(data: WebSocket.RawData): Uint8Array<ArrayBufferLike> {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data))
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (typeof data === 'string') {
    return new Uint8Array(Buffer.from(data, 'utf-8'))
  }
  return new Uint8Array(data as Buffer)
}
