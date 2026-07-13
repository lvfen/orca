import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { RelayRole } from './protocol.js'

// Why: each token is a self-describing credential. A phone that pastes only the
// mobile token already knows which relay to dial, which room to join, and the
// secret to authenticate — no separate config needed.
export type TokenPayload = {
  relayUrl: string
  roomId: string
  secret: string
}

// Why: the prefix makes a token self-identifying (PC vs mobile) at a glance and
// lets the UI reject a token pasted into the wrong field before any decode.
const TOKEN_PREFIX: Record<RelayRole, string> = {
  host: 'orca-pc_',
  client: 'orca-mb_'
}

const ROOM_ID_BYTES = 9
const SECRET_BYTES = 32

export function base64urlEncode(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

export function generateRoomId(): string {
  return base64urlEncode(randomBytes(ROOM_ID_BYTES))
}

export function generateSecret(): string {
  return base64urlEncode(randomBytes(SECRET_BYTES))
}

export function encodeToken(role: RelayRole, payload: TokenPayload): string {
  const json = JSON.stringify(payload)
  return `${TOKEN_PREFIX[role]}${base64urlEncode(Buffer.from(json, 'utf-8'))}`
}

export type DecodedToken = {
  role: RelayRole
  payload: TokenPayload
}

export function decodeToken(token: string): DecodedToken | null {
  const role = roleFromPrefix(token)
  if (!role) {
    return null
  }
  const body = token.slice(TOKEN_PREFIX[role].length)
  let parsed: unknown
  try {
    parsed = JSON.parse(base64urlDecode(body).toString('utf-8'))
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

function roleFromPrefix(token: string): RelayRole | null {
  if (token.startsWith(TOKEN_PREFIX.host)) {
    return 'host'
  }
  if (token.startsWith(TOKEN_PREFIX.client)) {
    return 'client'
  }
  return null
}

// Why: token comparison is an auth boundary; use a constant-time compare so a
// relay observer cannot recover the secret byte-by-byte via timing.
export function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8')
  const bufB = Buffer.from(b, 'utf-8')
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export type TokenPair = {
  pcToken: string
  mobileToken: string
}

export function generateTokenPair(relayUrl: string, roomId: string): TokenPair {
  const secret = generateSecret()
  const payload: TokenPayload = { relayUrl, roomId, secret }
  return {
    pcToken: encodeToken('host', payload),
    mobileToken: encodeToken('client', payload)
  }
}
