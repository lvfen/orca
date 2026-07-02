import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
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
  roleForJoin,
  type RelayRole
} from './protocol.js'
import { rawDataByteLength, rawDataToString } from './raw-data.js'
import { SlidingWindowRateLimiter } from './rate-limiter.js'
import { RelayMetrics, type RelayMetricsSnapshot } from './relay-metrics.js'
import { RoomHub } from './room-runtime.js'
import { lookupToken, type RoomStore } from './room-store.js'
import { clientIp, rejectSocket } from './socket-admission.js'
import { tokensEqual } from './token.js'

type ConnectionState = {
  roomId: string | null
  role: RelayRole | null
  joinTimer: ReturnType<typeof setTimeout> | null
  connectedAt: number
}

// Why: WebSocket 1013 (Try Again Later) tells a well-behaved client to back off
// and retry instead of treating the rejection as terminal — the right signal for
// rate-limit / over-capacity refusals.
const WS_TRY_AGAIN_LATER = 1013
const RATE_LIMIT_WINDOW_MS = 60_000

export type RelayServerOptions = {
  config: RelayConfig
  store: RoomStore
  // Why: test-only overrides. Production uses the protocol/config constants.
  heartbeatIntervalMs?: number
  preJoinTimeoutMs?: number
  maxConnectionsPerWindow?: number
  rateLimitWindowMs?: number
  maxConcurrentConnections?: number
  trustProxy?: boolean
  now?: () => number
}

export class RelayServer {
  private readonly config: RelayConfig
  private readonly store: RoomStore
  private readonly metrics = new RelayMetrics()
  private readonly hub: RoomHub
  private readonly heartbeat: HeartbeatMonitor
  private readonly rateLimiter: SlidingWindowRateLimiter
  private readonly preJoinTimeoutMs: number
  private readonly maxConcurrentConnections: number
  private readonly trustProxy: boolean
  private httpServer: HttpServer | HttpsServer | null = null
  private wss: WebSocketServer | null = null
  private rateLimitSweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly connections = new Map<WebSocket, ConnectionState>()

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

  get connectionCount(): number {
    return this.connections.size
  }

  get liveRoomCount(): number {
    return this.hub.liveRoomCount
  }

  getMetrics(): RelayMetricsSnapshot {
    return this.metrics.snapshot(this.connections.size, this.hub.liveRoomCount)
  }

  async start(): Promise<void> {
    if (this.wss) {
      return
    }
    const httpServer = this.createHttpServer()
    httpServer.on('request', (req, res) => this.handleHttpRequest(req, res))
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

  private createHttpServer(): HttpServer | HttpsServer {
    if (this.config.tlsCert && this.config.tlsKey) {
      return createHttpsServer({ cert: this.config.tlsCert, key: this.config.tlsKey })
    }
    return createHttpServer()
  }

  // Why: GET /healthz (or /metrics) exposes connection-level counters as JSON for
  // uptime probes / operators. Every other plain HTTP request is a non-upgrade
  // hit on the WS port, so answer 426 Upgrade Required.
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/metrics')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(this.getMetrics()))
      return
    }
    res.writeHead(426, { 'content-type': 'text/plain' })
    res.end('Upgrade Required')
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    if (this.connections.size >= this.maxConcurrentConnections) {
      this.metrics.connectionsRejectedOverCapacity += 1
      rejectSocket(ws, WS_TRY_AGAIN_LATER, 'over capacity')
      return
    }
    if (!this.rateLimiter.tryAcquire(clientIp(req, this.trustProxy))) {
      this.metrics.connectionsRejectedRateLimited += 1
      rejectSocket(ws, WS_TRY_AGAIN_LATER, 'rate limited')
      return
    }
    this.metrics.connectionsTotal += 1

    const state: ConnectionState = {
      roomId: null,
      role: null,
      joinTimer: null,
      connectedAt: Date.now()
    }
    this.connections.set(ws, state)
    this.heartbeat.markAlive(ws)

    state.joinTimer = setTimeout(() => {
      if (state.role === null) {
        this.metrics.joinRejections += 1
        ws.close(RelayCloseCode.BadJoin, 'join timeout')
      }
    }, this.preJoinTimeoutMs)
    if (typeof state.joinTimer.unref === 'function') {
      state.joinTimer.unref()
    }

    ws.on('pong', () => this.heartbeat.markAlive(ws))
    ws.on('message', (data: RawData, isBinary: boolean) => {
      this.heartbeat.markAlive(ws)
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
    state: ConnectionState,
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

  private finalize(ws: WebSocket): void {
    const state = this.connections.get(ws)
    if (!state) {
      return
    }
    this.connections.delete(ws)
    if (state.joinTimer) {
      clearTimeout(state.joinTimer)
    }
    if (state.roomId && state.role) {
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
