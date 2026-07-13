import { createHash } from 'node:crypto'

export const RELAY_CERTIFICATE_TOKEN_PREFIX = 'orca-cert_'
export const RELAY_CERTIFICATE_TOKEN_VERSION = 1

export type RelayCertificateTokenPayload = {
  v: typeof RELAY_CERTIFICATE_TOKEN_VERSION
  name: string
  host: string
  relayUrl: string
  caCertDerB64: string
  iosMobileConfigB64: string
  sha256B64: string
}

export function buildRelayCertificateToken(input: {
  name: string
  host: string
  relayUrl: string
  caCertDer: Buffer
  iosMobileConfig: string
}): string {
  return encodeRelayCertificateToken({
    v: RELAY_CERTIFICATE_TOKEN_VERSION,
    name: input.name,
    host: input.host,
    relayUrl: input.relayUrl,
    caCertDerB64: input.caCertDer.toString('base64'),
    iosMobileConfigB64: Buffer.from(input.iosMobileConfig, 'utf8').toString('base64'),
    sha256B64: createHash('sha256').update(input.caCertDer).digest('base64')
  })
}

export function encodeRelayCertificateToken(payload: RelayCertificateTokenPayload): string {
  return `${RELAY_CERTIFICATE_TOKEN_PREFIX}${Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  )}`
}

export function decodeRelayCertificateToken(token: string): RelayCertificateTokenPayload | null {
  if (!token.startsWith(RELAY_CERTIFICATE_TOKEN_PREFIX)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(
      Buffer.from(token.slice(RELAY_CERTIFICATE_TOKEN_PREFIX.length), 'base64url').toString('utf8')
    )
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
