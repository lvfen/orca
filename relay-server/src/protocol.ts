// Why: the relay is a dumb byte pipe. It only ever parses the FIRST frame a
// socket sends (the join control frame); every subsequent frame is opaque
// E2EE ciphertext forwarded verbatim. These types describe that thin
// plaintext-JSON control protocol. Desktop/mobile mirror this file — keep the
// `type` string values stable across all three ends.

// Why: max bytes per WebSocket message. Mirrors MAX_WS_MESSAGE_BYTES in
// src/main/runtime/rpc/ws-transport.ts so a relayed frame can never exceed what
// the desktop transport itself would have accepted on a direct LAN socket.
export const MAX_WS_MESSAGE_BYTES = 1024 * 1024

// Why: ping cadence + half-open reaping. Mirrors HEARTBEAT_INTERVAL_MS in
// ws-transport.ts: phones background-suspend their sockets without a TCP FIN,
// so the only reliable reaper is an app-level ping every 15s and a terminate of
// any socket that did not pong by the next sweep.
export const HEARTBEAT_INTERVAL_MS = 15_000

// Why: a socket that connects but never sends a valid join frame occupies a
// room slot for free. Terminate it if it stays silent past this window
// (mirrors PRE_AUTH_TIMEOUT_MS in ws-transport.ts).
export const PRE_JOIN_TIMEOUT_MS = 10_000

// Why: close codes carry the reason so each peer knows whether to reconnect.
// 4000-4999 is the WebSocket private-use range. These values are part of the
// wire contract with the desktop/mobile clients — do not renumber.
export const RelayCloseCode = {
  // A new socket with the same token superseded this one. Terminal for the
  // displaced peer (do NOT auto-reconnect, or two ends loop forever).
  Occupied: 4409,
  // The paired socket dropped, so the relay recycled this one too (lifecycle
  // coupling). The peer reconnects and waits again.
  PeerRecycled: 4408,
  // Token invalid / rotated / revoked. Terminal → re-pair.
  Unauthorized: 4401,
  // First frame was not a well-formed join frame.
  BadJoin: 4400,
  // Relay is shutting down.
  GoingAway: 1001
} as const

export type RelayCloseCodeValue = (typeof RelayCloseCode)[keyof typeof RelayCloseCode]

export const RELAY_CLOSE_REASON: Record<RelayCloseCodeValue, string> = {
  [RelayCloseCode.Occupied]: 'occupied',
  [RelayCloseCode.PeerRecycled]: 'peer-recycled',
  [RelayCloseCode.Unauthorized]: 'unauthorized',
  [RelayCloseCode.BadJoin]: 'bad-join',
  [RelayCloseCode.GoingAway]: 'going-away'
}

export type RelayRole = 'host' | 'client'

// Client → relay: the first frame each socket must send.
export type HostJoinFrame = { type: 'host-join'; token: string }
export type ClientJoinFrame = { type: 'client-join'; token: string }
export type JoinFrame = HostJoinFrame | ClientJoinFrame

// Relay → client: advisory control frames emitted only around the join phase.
// The authoritative lifecycle signals are the WebSocket close codes above;
// these frames just let the UI render "paired"/"desktop offline" promptly.
export type HostJoinAckFrame = { type: 'host-join-ack' }
export type RoomReadyFrame = { type: 'room-ready' }
export type HostOfflineFrame = { type: 'host-offline' }
export type PeerOnlineFrame = { type: 'peer-online' }
export type RelayControlFrame =
  | HostJoinAckFrame
  | RoomReadyFrame
  | HostOfflineFrame
  | PeerOnlineFrame

const RELAY_CONTROL_TYPES = new Set<string>([
  'host-join-ack',
  'room-ready',
  'host-offline',
  'peer-online'
])

// Why: desktop/mobile use this to split relay-origin control frames from
// forwarded E2EE data on the same socket. E2EE/RPC frames never use these
// `type` values, so the discriminator is unambiguous.
export function isRelayControlFrame(value: unknown): value is RelayControlFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    RELAY_CONTROL_TYPES.has((value as { type: string }).type)
  )
}

export function encodeControlFrame(frame: RelayControlFrame): string {
  return JSON.stringify(frame)
}

// Why: only the first frame is parsed as a join. A malformed or non-join first
// frame is rejected (BadJoin / Unauthorized) rather than forwarded, so a socket
// can never reach the pipe without authenticating to a room slot.
export function parseJoinFrame(raw: string): JoinFrame | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const candidate = parsed as { type?: unknown; token?: unknown }
  if (candidate.type !== 'host-join' && candidate.type !== 'client-join') {
    return null
  }
  if (typeof candidate.token !== 'string' || candidate.token.length === 0) {
    return null
  }
  return candidate.type === 'host-join'
    ? { type: 'host-join', token: candidate.token }
    : { type: 'client-join', token: candidate.token }
}

export function roleForJoin(frame: JoinFrame): RelayRole {
  return frame.type === 'host-join' ? 'host' : 'client'
}
