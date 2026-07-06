import { WebSocket } from 'ws'

export class RelayV2TransportKeepalive {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly intervalMs: number) {}

  start(ws: WebSocket, currentWs: () => WebSocket | null): void {
    this.clear()
    this.timer = setInterval(() => {
      if (ws !== currentWs() || ws.readyState !== WebSocket.OPEN) {
        return
      }
      try {
        // Why: some public relay paths close otherwise-idle WebSockets around
        // the 2-minute mark. Client pings keep the PC leg active between RPCs.
        ws.ping()
      } catch {
        // The close handler schedules reconnect if the socket is gone.
      }
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
  }

  clear(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
