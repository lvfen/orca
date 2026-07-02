// Why: mobile mirror of relay-server/src/token.ts. A mobile token (orca-mb_)
// is a self-describing credential carrying { relayUrl, roomId, secret }. The
// phone decodes it at "Add via Server Token" time to learn which relay to dial
// and which room to join — no separate relay config to type.

export type RelayTokenPayload = {
  relayUrl: string
  roomId: string
  secret: string
}

const MOBILE_TOKEN_PREFIX = 'orca-mb_'

// Why: Hermes lacks Buffer; decode base64url via atob + manual UTF-8 decode
// (the same primitives e2ee.ts relies on).
function base64urlDecodeToString(value: string): string {
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = base64.length % 4
  if (remainder === 2) {
    base64 += '=='
  } else if (remainder === 3) {
    base64 += '='
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

// The out-of-band E2EE identity scanned from the desktop "Server Token" QR.
// Why: this is what closes MITM even against a malicious relay — the desktop's
// public key reaches the phone outside the relay path.
export type RelayServerToken = {
  publicKeyB64: string
  deviceToken: string
}

const SERVER_TOKEN_VERSION = 1

// Why: matches the JSON the desktop encodes in mobile:getRelayServerToken —
// { v: 1, publicKeyB64, deviceToken }. The QR carries the raw JSON string.
export function decodeRelayServerToken(raw: string): RelayServerToken | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (
    candidate.v !== SERVER_TOKEN_VERSION ||
    typeof candidate.publicKeyB64 !== 'string' ||
    typeof candidate.deviceToken !== 'string' ||
    candidate.publicKeyB64.length === 0 ||
    candidate.deviceToken.length === 0
  ) {
    return null
  }
  return {
    publicKeyB64: candidate.publicKeyB64,
    deviceToken: candidate.deviceToken
  }
}

export function decodeMobileToken(token: string): RelayTokenPayload | null {
  if (!token.startsWith(MOBILE_TOKEN_PREFIX)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(base64urlDecodeToString(token.slice(MOBILE_TOKEN_PREFIX.length)))
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
    relayUrl: candidate.relayUrl,
    roomId: candidate.roomId,
    secret: candidate.secret
  }
}
