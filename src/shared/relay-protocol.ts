// Why: desktop/mobile mirror of the relay wire contract defined in
// relay-server/src/protocol.ts. The relay forwards opaque E2EE frames; the only
// frames either end parses are the join control frames it sends and the small
// advisory control frames the relay sends back. Keep the `type` string values
// and close-code numbers in lockstep with the relay server.

// Why: close codes carry the reconnect reason. 4000-4999 is the WebSocket
// private-use range. These are part of the wire contract — do not renumber.
export const RelayCloseCode = {
  // A new socket with the same token superseded this one. Terminal for the
  // displaced peer: do NOT auto-reconnect, or two ends loop forever.
  Occupied: 4409,
  // The paired socket dropped, so the relay recycled this one (lifecycle
  // coupling). Reconnect and wait again.
  PeerRecycled: 4408,
  // Token invalid / rotated / revoked. Terminal → re-pair.
  Unauthorized: 4401,
  // Malformed/absent join frame.
  BadJoin: 4400
} as const

export type RelayRole = 'host' | 'client'

// Why: the desktop relay host socket's lifecycle, surfaced to the renderer for
// the Server Token settings UI. Lives in shared (not the main-process transport)
// so the preload bridge can type it without importing Node-only deps.
export type RelayConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'occupied'
  | 'unauthorized'

export type RelayStatus = {
  state: RelayConnectionState
  // Reconnect attempt count; 0 while connected or freshly connecting.
  attempt: number
  // True between the relay's peer-online and the next socket close.
  phoneOnline: boolean
}

// Client → relay: the first frame each socket sends.
export type HostJoinFrame = { type: 'host-join'; token: string }
export type ClientJoinFrame = { type: 'client-join'; token: string }

// Relay → client: advisory control frames around the join phase.
export type RelayControlFrame =
  | { type: 'host-join-ack' }
  | { type: 'room-ready' }
  | { type: 'host-offline' }
  | { type: 'peer-online' }

export type RelayControlType = RelayControlFrame['type']

const RELAY_CONTROL_TYPES = new Set<RelayControlType>([
  'host-join-ack',
  'room-ready',
  'host-offline',
  'peer-online'
])

export function encodeHostJoin(token: string): string {
  return JSON.stringify({ type: 'host-join', token } satisfies HostJoinFrame)
}

export function encodeClientJoin(token: string): string {
  return JSON.stringify({ type: 'client-join', token } satisfies ClientJoinFrame)
}

// Why: both ends use this to split relay-origin control frames from forwarded
// E2EE data on the same socket. E2EE/RPC frames never use these `type` values
// (they use `e2ee_*` or an `id` field), so the discriminator is unambiguous.
export function parseRelayControlFrame(raw: string): RelayControlFrame | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const type = (parsed as { type?: unknown }).type
  if (typeof type !== 'string' || !RELAY_CONTROL_TYPES.has(type as RelayControlType)) {
    return null
  }
  return { type: type as RelayControlType }
}

// Why: a close code that should stop the reconnect loop (terminal). Everything
// else (peer-recycled, network 1006, relay restart 1000/1001) is recoverable.
export function isTerminalCloseCode(code: number): boolean {
  return code === RelayCloseCode.Occupied || code === RelayCloseCode.Unauthorized
}
