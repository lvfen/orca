// Why: mobile mirror of the relay wire contract (relay-server/src/protocol.ts
// and src/shared/relay-protocol.ts on the desktop). The relay forwards opaque
// E2EE frames; the phone only parses the join control frames the relay sends
// back. Keep the `type` strings and close-code numbers in lockstep with the
// relay server — they are the wire contract.

// Why: close codes carry the reconnect reason (WebSocket private-use range).
// Do not renumber — both ends and the relay agree on these.
export const RelayCloseCode = {
  // A new socket with the same token superseded this one. Terminal → do not
  // auto-reconnect, or the two ends loop forever.
  Occupied: 4409,
  // The paired socket dropped, so the relay recycled this one. Reconnect.
  PeerRecycled: 4408,
  // Token invalid / rotated / revoked. Terminal → re-pair.
  Unauthorized: 4401,
  // Malformed/absent join frame.
  BadJoin: 4400
} as const

export type RelayControlType = 'host-join-ack' | 'room-ready' | 'host-offline' | 'peer-online'

const RELAY_CONTROL_TYPES = new Set<RelayControlType>([
  'host-join-ack',
  'room-ready',
  'host-offline',
  'peer-online'
])

export function encodeClientJoin(mobileToken: string): string {
  return JSON.stringify({ type: 'client-join', token: mobileToken })
}

// Why: split relay-origin control frames from forwarded E2EE data on the same
// socket. E2EE/RPC frames never use these `type` values (they use `e2ee_*` or
// an `id` field), so the discriminator is unambiguous.
export function parseRelayControlFrame(raw: string): { type: RelayControlType } | null {
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
