import type { RelayConnectionState } from '@/../../shared/relay-protocol'

// Why: the relay host socket can be connected, mid-(re)connect, idle (no token),
// or in a terminal failure (occupied/unauthorized). The settings UI maps each to
// a colour tone and decides whether to surface the re-pair recovery path.
export type RelayStatusTone = 'connected' | 'pending' | 'danger' | 'idle'

export function relayStatusTone(state: RelayConnectionState): RelayStatusTone {
  switch (state) {
    case 'connected':
      return 'connected'
    case 'connecting':
    case 'reconnecting':
      return 'pending'
    case 'occupied':
    case 'unauthorized':
      return 'danger'
    case 'disconnected':
      return 'idle'
  }
}

// Why: occupied (slot taken over by the same token elsewhere) and unauthorized
// (token rotated/revoked) are terminal — the desktop stopped its reconnect loop,
// so the only recovery is to re-pair. Everything else either self-heals
// (reconnect backoff) or is awaiting a token.
export function isRelayTerminalState(state: RelayConnectionState): boolean {
  return state === 'occupied' || state === 'unauthorized'
}
