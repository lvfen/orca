// Why: desktop/mobile mirror of relay-server/src/token.ts. A relay token is a
// self-describing credential: a prefix (PC vs mobile) plus a base64url blob
// carrying { relayUrl, roomId, secret }. Decoding lets the desktop learn which
// relay to dial straight from the pasted PC token — no separate config.
import type { RelayRole } from './relay-protocol'

export type RelayTokenPayload = {
  relayUrl: string
  roomId: string
  secret: string
}

const TOKEN_PREFIX: Record<RelayRole, string> = {
  host: 'orca-pc_',
  client: 'orca-mb_'
}

export type DecodedRelayToken = {
  role: RelayRole
  payload: RelayTokenPayload
}

function base64urlDecode(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

export function decodeRelayToken(token: string): DecodedRelayToken | null {
  const role = roleFromPrefix(token)
  if (!role) {
    return null
  }
  const body = token.slice(TOKEN_PREFIX[role].length)
  let parsed: unknown
  try {
    parsed = JSON.parse(base64urlDecode(body))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (
    typeof candidate.relayUrl !== 'string' ||
    typeof candidate.roomId !== 'string' ||
    typeof candidate.secret !== 'string' ||
    candidate.relayUrl.length === 0 ||
    candidate.roomId.length === 0 ||
    candidate.secret.length === 0
  ) {
    return null
  }
  return {
    role,
    payload: {
      relayUrl: candidate.relayUrl,
      roomId: candidate.roomId,
      secret: candidate.secret
    }
  }
}

// Why: the desktop only ever holds a PC token; this rejects a mobile token (or
// junk) pasted into the Server Token field before any connection attempt.
export function decodePcToken(token: string): DecodedRelayToken | null {
  const decoded = decodeRelayToken(token)
  return decoded?.role === 'host' ? decoded : null
}

function roleFromPrefix(token: string): RelayRole | null {
  if (token.startsWith(TOKEN_PREFIX.host)) {
    return 'host'
  }
  if (token.startsWith(TOKEN_PREFIX.client)) {
    return 'client'
  }
  return null
}
