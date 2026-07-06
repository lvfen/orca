import type { IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  RELAY_DEFAULT_MAX_CONCURRENT_CONNECTIONS,
  RELAY_DEFAULT_MAX_CONNECTIONS_PER_IP_PER_MINUTE,
  type RelayConfig
} from './config.js'
import { HeartbeatMonitor } from './heartbeat-monitor.js'
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_WS_MESSAGE_BYTES,
  PRE_JOIN_TIMEOUT_MS,
  RelayCloseCode,
  parseJoinFrame,
  roleForJoin
} from './protocol.js'
import { rawDataByteLength, rawDataToString } from './raw-data.js'
import { SlidingWindowRateLimiter } from './rate-limiter.js'
import { createRelayConnectionState, type RelayConnectionState } from './relay-connection-state.js'
import { buildRelayHttpRequestOptions } from './relay-http-request-options.js'
import { armPreJoinTimeout } from './relay-join-timeout.js'
import { RelayMetrics, type RelayMetricsSnapshot } from './relay-metrics.js'
import {
  createRelayHttpServer,
  handleRelayHttpRequest,
  type RelayHttpServer
} from './relay-server-http.js'
import type { RelayServerOptions } from './relay-server-options.js'
import { RoomHub } from './room-runtime.js'
import { lookupToken, type RoomStore } from './room-store.js'
import { clientIp, rejectSocket } from './socket-admission.js'
import { tokensEqual } from './token.js'
import { parseRelayV2ClientMessage, type RelayV2ClientMessage } from './v2/relay-v2-protocol.js'
import { RelayV2Runtime } from './v2/relay-v2-runtime.js'

export type { RelayServerOptions } from './relay-server-options.js'

// Why: WebSocket 1013 (Try Again Later) tells a well-behaved client to back off
// and retry instead of treating the rejection as terminal — the right signal for
// rate-limit / over-capacity refusals.
const WS_TRY_AGAIN_LATER = 1013
const RATE_LIMIT_WINDOW_MS = 60_000

export class RelayServer {
  private readonly config: RelayConfig
  private readonly store: RoomStore
  private readonly metrics = new RelayMetrics()
  private readonly hub: RoomHub
  private readonly heartbeat: HeartbeatMonitor
  private readonly v2Runtime: RelayV2Runtime | null
  private readonly rateLimiter: SlidingWindowRateLimiter
  private readonly preJoinTimeoutMs: number
  private readonly maxConcurrentConnections: number
  private readonly trustProxy: boolean
  private httpServer: RelayHttpServer | null = null
  private wss: WebSocketServer | null = null
  private rateLimitSweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly connections = new Map<WebSocket, RelayConnectionState>()

  constructor(options: RelayServerOptions) {
    this.config = options.config
    this.store = options.store
    this.preJoinTimeoutMs = options.preJoinTimeoutMs ?? PRE_JOIN_TIMEOUT_MS
    this.maxConcurrentConnections =
      options.maxConcurrentConnections ??
      this.config.maxConcurrentConnections ??
      RELAY_DEFAULT_MAX_CONCURRENT_CONNECTIONS
    this.trustProxy = options.trustProxy ?? this.config.trustProxy ?? false
    this.hub = new RoomHub((event) => {
      if (event === 'superseded') {
        this.metrics.superseded += 1
      } else {
        this.metrics.peerRecycled += 1
      }
    })
    this.heartbeat = new HeartbeatMonitor(
      options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      () => this.wss?.clients ?? []
    )
    this.v2Runtime = options.v2Store
      ? new RelayV2Runtime({
          store: options.v2Store,
          publicUrl: this.config.publicUrl,
          ...options.relayV2
        })
      : null
    const maxEvents =
      options.maxConnectionsPerWindow ??
      this.config.maxConnectionsPerIpPerMinute ??
      RELAY_DEFAULT_MAX_CONNECTIONS_PER_IP_PER_MINUTE
    const windowMs = options.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS
    this.rateLimiter = new SlidingWindowRateLimiter(
      options.now ? { maxEvents, windowMs, now: options.now } : { maxEvents, windowMs }
    )
  }

  // Why: when port 0 is passed the OS assigns a port; tests read the real one.
  get resolvedPort(): number {
    const addr = this.httpServer?.address()
    if (addr && typeof addr === 'object') {
      return (addr as AddressInfo).port
    }
    return this.config.port
  }

  getMetrics(): RelayMetricsSnapshot {
    return this.metrics.snapshot(this.connections.size, this.hub.liveRoomCount)
  }

  async start(): Promise<void> {
    if (this.wss) {
      return
    }
    const httpServer = createRelayHttpServer(this.config)
    httpServer.on('request', (req, res) =>
      handleRelayHttpRequest(
        req,
        res,
        buildRelayHttpRequestOptions({
          config: this.config,
          metrics: this.getMetrics(),
          v2Runtime: this.v2Runtime
        })
      )
    )
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(this.config.port, this.config.host, () => {
        httpServer.off('error', reject)
        resolve()
      })
    })

    const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_WS_MESSAGE_BYTES })
    wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    this.httpServer = httpServer
    this.wss = wss
    this.heartbeat.start()
    this.startRateLimitSweep()
  }

  async stop(): Promise<void> {
    const wss = this.wss
    const httpServer = this.httpServer
    this.wss = null
    this.httpServer = null
    this.heartbeat.stop()
    this.v2Runtime?.stop()
    this.stopRateLimitSweep()

    if (wss) {
      for (const client of wss.clients) {
        // Why: a half-open socket may never answer a graceful close frame,
        // which would keep httpServer.close pending. terminate() frees it now.
        client.terminate()
      }
      wss.close()
    }
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteAddress = clientIp(req, this.trustProxy)
    if (this.connections.size >= this.maxConcurrentConnections) {
      this.metrics.connectionsRejectedOverCapacity += 1
      rejectSocket(ws, WS_TRY_AGAIN_LATER, 'over capacity')
      return
    }
    if (!this.rateLimiter.tryAcquire(remoteAddress)) {
      this.metrics.connectionsRejectedRateLimited += 1
      rejectSocket(ws, WS_TRY_AGAIN_LATER, 'rate limited')
      return
    }
    this.metrics.connectionsTotal += 1

    const state = createRelayConnectionState(remoteAddress)
    this.connections.set(ws, state)
    this.heartbeat.markAlive(ws)

    armPreJoinTimeout(ws, state, this.metrics, this.preJoinTimeoutMs)

    ws.on('ping', () => this.heartbeat.markAlive(ws))
    ws.on('pong', () => this.heartbeat.markAlive(ws))
    ws.on('message', (data: RawData, isBinary: boolean) => {
      this.heartbeat.markAlive(ws)
      if (state.v2) {
        this.v2Runtime?.handleMessage(ws, state.v2, data, isBinary)
        return
      }
      if (state.role === null) {
        this.handleJoin(ws, state, data, isBinary)
        return
      }
      if (state.roomId) {
        this.metrics.forwardedMessages += 1
        this.metrics.forwardedBytes += rawDataByteLength(data)
        this.hub.forward(state.roomId, state.role, data, isBinary)
      }
    })
    ws.on('close', () => this.finalize(ws))
    ws.on('error', () => {
      this.finalize(ws)
      try {
        ws.close()
      } catch {
        // Why: socket may already be closing; finalize already ran.
      }
    })
  }

  private handleJoin(
    ws: WebSocket,
    state: RelayConnectionState,
    data: RawData,
    isBinary: boolean
  ): void {
    if (isBinary) {
      this.metrics.joinRejections += 1
      ws.close(RelayCloseCode.BadJoin, 'binary join')
      return
    }
    const frame = parseJoinFrame(rawDataToString(data))
    if (!frame) {
      const v2Message = this.v2Runtime ? parseRelayV2ClientMessage(rawDataToString(data)) : null
      if (v2Message) {
        this.handleRelayV2Join(ws, state, v2Message)
        return
      }
    }
    if (!frame) {
      this.metrics.joinRejections += 1
      ws.close(RelayCloseCode.BadJoin, 'malformed join')
      return
    }
    const result = lookupToken(this.store, frame.token)
    // Why: auth requires BOTH a constant-time token-string match AND that the
    // join frame's role matches the token's role — so a mobile token cannot be
    // used to claim the host slot, and vice versa.
    if (
      !result ||
      result.lookup.role !== roleForJoin(frame) ||
      !tokensEqual(frame.token, result.expected)
    ) {
      this.metrics.joinRejections += 1
      ws.close(RelayCloseCode.Unauthorized, 'unauthorized')
      return
    }
    state.role = result.lookup.role
    state.roomId = result.lookup.room.roomId
    if (state.joinTimer) {
      clearTimeout(state.joinTimer)
      state.joinTimer = null
    }
    if (state.role === 'host') {
      this.metrics.joinsHost += 1
    } else {
      this.metrics.joinsClient += 1
    }
    console.info(`[relay] join room=${state.roomId} role=${state.role}`)
    this.hub.bind(state.roomId, state.role, ws)
  }

  private handleRelayV2Join(
    ws: WebSocket,
    state: RelayConnectionState,
    message: RelayV2ClientMessage
  ): void {
    const v2 =
      this.v2Runtime?.acceptInitialMessage(
        ws,
        message,
        state.remoteAddress ? { remoteAddress: state.remoteAddress } : {}
      ) ?? null
    if (!v2) {
      this.metrics.joinRejections += 1
      return
    }
    state.v2 = v2
    if (state.joinTimer) {
      clearTimeout(state.joinTimer)
      state.joinTimer = null
    }
  }

  private finalize(ws: WebSocket): void {
    const state = this.connections.get(ws)
    if (!state) {
      return
    }
    this.connections.delete(ws)
    if (state.joinTimer) {
      clearTimeout(state.joinTimer)
    }
    if (state.v2) {
      this.v2Runtime?.release(state.v2, ws)
    } else if (state.roomId && state.role) {
      console.info(
        `[relay] close room=${state.roomId} role=${state.role} aliveMs=${Date.now() - state.connectedAt}`
      )
      this.hub.release(state.roomId, state.role, ws)
    }
  }

  private startRateLimitSweep(): void {
    if (this.rateLimitSweepTimer) {
      return
    }
    this.rateLimitSweepTimer = setInterval(() => this.rateLimiter.sweep(), RATE_LIMIT_WINDOW_MS)
    if (typeof this.rateLimitSweepTimer.unref === 'function') {
      this.rateLimitSweepTimer.unref()
    }
  }

  private stopRateLimitSweep(): void {
    if (this.rateLimitSweepTimer) {
      clearInterval(this.rateLimitSweepTimer)
      this.rateLimitSweepTimer = null
    }
  }
}
