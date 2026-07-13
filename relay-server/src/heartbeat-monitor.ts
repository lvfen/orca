import type { WebSocket } from 'ws'

// Why: phones background-suspend their sockets without sending a TCP FIN, so the
// only reliable half-open detector is an app-level ping every interval and a
// terminate() of any socket that did not pong by the next sweep. Mirrors the
// HEARTBEAT_INTERVAL_MS logic in src/main/runtime/rpc/ws-transport.ts.
export class HeartbeatMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly alive = new WeakSet<WebSocket>()

  constructor(
    private readonly intervalMs: number,
    private readonly clients: () => Iterable<WebSocket>
  ) {}

  // Mark a socket alive: on accept, and on every pong/message it sends.
  markAlive(ws: WebSocket): void {
    this.alive.add(ws)
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      for (const ws of this.clients()) {
        if (!this.alive.has(ws)) {
          // Missed the previous ping's pong → assume half-open and reap it.
          ws.terminate()
          continue
        }
        this.alive.delete(ws)
        try {
          ws.ping()
        } catch {
          // ping() can throw mid-teardown; the close handler runs anyway.
        }
      }
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
