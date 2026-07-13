import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { decodeRelayCertificateToken } from '../../shared/relay-certificate-token'

const CERTIFICATE_TOKEN_PATH = '/.well-known/orca-relay/cert-token'
const MAX_CERTIFICATE_TOKEN_BYTES = 128 * 1024
const CERTIFICATE_TOKEN_TIMEOUT_MS = 10_000

export type RelayCertificateDiscoveryResult =
  | { ok: true; token: string }
  | {
      ok: false
      reason: 'invalid-url' | 'download-failed' | 'invalid-token' | 'relay-url-mismatch'
    }

export async function discoverRelayCertificateToken(
  relayUrl: string
): Promise<RelayCertificateDiscoveryResult> {
  const discoveryUrl = buildRelayCertificateDiscoveryUrl(relayUrl)
  const normalizedRelayUrl = normalizeRelayUrlForCertificate(relayUrl)
  if (!discoveryUrl || !normalizedRelayUrl) {
    return { ok: false, reason: 'invalid-url' }
  }
  const token = (await fetchCertificateToken(discoveryUrl))?.trim()
  if (!token) {
    return { ok: false, reason: 'download-failed' }
  }
  return validateRelayCertificateTokenForUrl(token, normalizedRelayUrl)
}

export function buildRelayCertificateDiscoveryUrl(relayUrl: string): string | null {
  const parsed = parseRelayUrl(relayUrl)
  if (!parsed) {
    return null
  }
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:'
  parsed.pathname = CERTIFICATE_TOKEN_PATH
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

export function validateRelayCertificateTokenForUrl(
  token: string,
  relayUrl: string
): RelayCertificateDiscoveryResult {
  const certificate = decodeRelayCertificateToken(token)
  if (!certificate) {
    return { ok: false, reason: 'invalid-token' }
  }
  if (normalizeRelayUrlForCertificate(certificate.relayUrl) !== relayUrl) {
    return { ok: false, reason: 'relay-url-mismatch' }
  }
  return { ok: true, token }
}

function normalizeRelayUrlForCertificate(relayUrl: string): string | null {
  const parsed = parseRelayUrl(relayUrl)
  if (!parsed) {
    return null
  }
  const formatted = parsed.toString()
  return parsed.pathname === '/' && !parsed.search && !parsed.hash
    ? formatted.replace(/\/$/, '')
    : formatted
}

function parseRelayUrl(relayUrl: string): URL | null {
  try {
    const parsed = new URL(relayUrl.trim())
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:' ? parsed : null
  } catch {
    return null
  }
}

async function fetchCertificateToken(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const onResponse = (response: IncomingMessage): void => {
      if (response.statusCode !== 200) {
        response.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      let totalBytes = 0
      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > MAX_CERTIFICATE_TOKEN_BYTES) {
          response.destroy()
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      response.on('error', () => resolve(null))
    }
    // Why: this endpoint is specifically for bootstrapping a not-yet-trusted
    // local CA. The token is validated against the requested relay URL before
    // it is handed to the OS certificate installer.
    const request =
      parsed.protocol === 'https:'
        ? httpsGet(parsed, { rejectUnauthorized: false }, onResponse)
        : httpGet(parsed, onResponse)
    request.setTimeout(CERTIFICATE_TOKEN_TIMEOUT_MS, () => request.destroy())
    request.on('error', () => resolve(null))
  })
}
