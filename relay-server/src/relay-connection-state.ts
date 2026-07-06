import type { RelayRole } from './protocol.js'
import type { RelayV2SocketState } from './v2/relay-v2-runtime.js'

export type RelayConnectionState = {
  roomId: string | null
  role: RelayRole | null
  v2: RelayV2SocketState | null
  joinTimer: ReturnType<typeof setTimeout> | null
  connectedAt: number
  remoteAddress?: string
}

export function createRelayConnectionState(remoteAddress: string): RelayConnectionState {
  return {
    roomId: null,
    role: null,
    v2: null,
    joinTimer: null,
    connectedAt: Date.now(),
    remoteAddress
  }
}
