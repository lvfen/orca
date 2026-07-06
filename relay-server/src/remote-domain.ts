import { isIP } from 'node:net'

export type RelayDomainEndpoint = {
  raw: string
  host: string
  port: number | null
  publicUrl: string
  isIpAddress: boolean
}

export function parseRelayDomainEndpoint(raw: string): RelayDomainEndpoint {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('domain cannot be empty')
  }
  const parsed = trimmed.includes('://')
    ? parseUrlEndpoint(trimmed)
    : parseAuthorityEndpoint(trimmed)
  return {
    raw: trimmed,
    host: parsed.host,
    port: parsed.port,
    publicUrl: buildPublicUrl(parsed.host, parsed.port),
    isIpAddress: isIP(parsed.host) !== 0
  }
}

export function hostForUrl(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

function parseUrlEndpoint(raw: string): { host: string; port: number | null } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid domain URL: ${raw}`)
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'https:') {
    throw new Error('domain URL must use wss:// or https://')
  }
  return {
    host: normalizeHost(url.hostname),
    port: parseOptionalPort(url.port)
  }
}

function parseAuthorityEndpoint(raw: string): { host: string; port: number | null } {
  if (raw.startsWith('[')) {
    const closing = raw.indexOf(']')
    if (closing === -1) {
      throw new Error(`Invalid bracketed IPv6 domain: ${raw}`)
    }
    const rest = raw.slice(closing + 1)
    return {
      host: normalizeHost(raw.slice(1, closing)),
      port: rest.startsWith(':') ? parseOptionalPort(rest.slice(1)) : null
    }
  }
  const firstColon = raw.indexOf(':')
  if (firstColon !== -1 && firstColon === raw.lastIndexOf(':')) {
    return {
      host: normalizeHost(raw.slice(0, firstColon)),
      port: parseOptionalPort(raw.slice(firstColon + 1))
    }
  }
  return { host: normalizeHost(raw), port: null }
}

function normalizeHost(raw: string): string {
  const host = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (!host || /[\s/]/.test(host)) {
    throw new Error(`Invalid domain host: ${raw}`)
  }
  return host
}

function parseOptionalPort(raw: string): number | null {
  if (!raw) {
    return null
  }
  const port = Number.parseInt(raw, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid domain port: ${raw}`)
  }
  return port
}

function buildPublicUrl(host: string, port: number | null): string {
  return `wss://${hostForUrl(host)}${port === null ? '' : `:${port}`}`
}
