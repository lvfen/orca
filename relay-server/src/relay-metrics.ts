// Why: connection-level observability for the relay WITHOUT persisting any
// forwarded payload (the relay stays a blind pipe). Counters are cumulative
// since process start; gauges (open sockets, live rooms) are sampled by the
// server at snapshot time. Surfaced as JSON via GET /healthz so an operator or
// uptime probe can watch the relay without attaching a debugger.

export type RelayMetricsSnapshot = {
  uptimeMs: number
  connectionsTotal: number
  connectionsRejectedRateLimited: number
  connectionsRejectedOverCapacity: number
  joinsHost: number
  joinsClient: number
  joinRejections: number
  superseded: number
  peerRecycled: number
  forwardedMessages: number
  forwardedBytes: number
  openConnections: number
  liveRooms: number
}

export class RelayMetrics {
  private readonly startedAt = Date.now()
  connectionsTotal = 0
  connectionsRejectedRateLimited = 0
  connectionsRejectedOverCapacity = 0
  joinsHost = 0
  joinsClient = 0
  joinRejections = 0
  superseded = 0
  peerRecycled = 0
  forwardedMessages = 0
  forwardedBytes = 0

  snapshot(openConnections: number, liveRooms: number): RelayMetricsSnapshot {
    return {
      uptimeMs: Date.now() - this.startedAt,
      connectionsTotal: this.connectionsTotal,
      connectionsRejectedRateLimited: this.connectionsRejectedRateLimited,
      connectionsRejectedOverCapacity: this.connectionsRejectedOverCapacity,
      joinsHost: this.joinsHost,
      joinsClient: this.joinsClient,
      joinRejections: this.joinRejections,
      superseded: this.superseded,
      peerRecycled: this.peerRecycled,
      forwardedMessages: this.forwardedMessages,
      forwardedBytes: this.forwardedBytes,
      openConnections,
      liveRooms
    }
  }
}
