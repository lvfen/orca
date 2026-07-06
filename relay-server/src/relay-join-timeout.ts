import type { WebSocket } from 'ws'
import type { RelayConnectionState } from './relay-connection-state.js'
import { RelayCloseCode } from './protocol.js'
import type { RelayMetrics } from './relay-metrics.js'

export function armPreJoinTimeout(
  ws: WebSocket,
  state: RelayConnectionState,
  metrics: RelayMetrics,
  timeoutMs: number
): void {
  state.joinTimer = setTimeout(() => {
    if (state.role === null && state.v2 === null) {
      metrics.joinRejections += 1
      ws.close(RelayCloseCode.BadJoin, 'join timeout')
    }
  }, timeoutMs)
  if (typeof state.joinTimer.unref === 'function') {
    state.joinTimer.unref()
  }
}
