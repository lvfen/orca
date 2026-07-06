export const RELAY_CERTIFICATE_TOKEN_PREFIX = 'orca-cert_'
const RELAY_CERTIFICATE_TOKEN_VERSION = 1

export type RelayCertificateTokenPayload = {
  v: typeof RELAY_CERTIFICATE_TOKEN_VERSION
  name: string
  host: string
  relayUrl: string
  caCertDerB64: string
  iosMobileConfigB64: string
  sha256B64: string
}

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

export function decodeRelayCertificateToken(token: string): RelayCertificateTokenPayload | null {
  if (!token.startsWith(RELAY_CERTIFICATE_TOKEN_PREFIX)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(base64urlDecodeToString(token.slice(RELAY_CERTIFICATE_TOKEN_PREFIX.length)))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }
  const candidate = parsed as Record<string, unknown>
  if (
    candidate.v !== RELAY_CERTIFICATE_TOKEN_VERSION ||
    typeof candidate.name !== 'string' ||
    typeof candidate.host !== 'string' ||
    typeof candidate.relayUrl !== 'string' ||
    typeof candidate.caCertDerB64 !== 'string' ||
    typeof candidate.iosMobileConfigB64 !== 'string' ||
    typeof candidate.sha256B64 !== 'string' ||
    candidate.name.length === 0 ||
    candidate.host.length === 0 ||
    candidate.relayUrl.length === 0 ||
    candidate.caCertDerB64.length === 0 ||
    candidate.iosMobileConfigB64.length === 0 ||
    candidate.sha256B64.length === 0
  ) {
    return null
  }
  return candidate as RelayCertificateTokenPayload
}
