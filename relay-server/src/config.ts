import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  loadCertificateDiscovery,
  type RelayCertificateDiscovery
} from './certificate-discovery.js'

export type RelayConfig = {
  host: string
  port: number
  // Why: baked into generated tokens so the phone/desktop know which relay to
  // dial. Must be the PUBLIC wss:// URL clients reach (behind the TLS proxy),
  // not the internal listen address.
  publicUrl: string
  storePath: string
  v2StorePath?: string
  accessToken: string
  adminToken?: string
  certificateDiscovery?: RelayCertificateDiscovery
  // Why: optional built-in TLS. Production typically terminates TLS at a
  // reverse proxy (Caddy/Nginx) and runs the relay as plain ws behind it.
  tlsCert?: string
  tlsKey?: string
  // Why: hardening (M5). Cap new connections per client IP per minute to absorb
  // reconnect storms / token brute-force, and cap total concurrent sockets so a
  // single relay can't be exhausted. trustProxy reads X-Forwarded-For so the
  // limiter keys on the real client IP when behind a TLS-terminating proxy
  // (otherwise every client looks like the proxy and the limit is useless).
  // Optional so older RelayConfig literals keep compiling; the server falls back
  // to RELAY_DEFAULT_* when unset.
  maxConnectionsPerIpPerMinute?: number
  maxConcurrentConnections?: number
  trustProxy?: boolean
}

export const RELAY_DEFAULT_MAX_CONNECTIONS_PER_IP_PER_MINUTE = 60
export const RELAY_DEFAULT_MAX_CONCURRENT_CONNECTIONS = 10_000

const DEFAULT_PORT = 6770
const DEFAULT_HOST = '0.0.0.0'

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const port = parsePort(env.RELAY_PORT) ?? DEFAULT_PORT
  const host = env.RELAY_HOST?.trim() || DEFAULT_HOST
  const storePath = env.RELAY_STORE_PATH?.trim() || defaultStorePath()
  const v2StorePath = env.RELAY_V2_STORE_PATH?.trim() || defaultV2StorePath(storePath)
  const publicUrl = env.RELAY_PUBLIC_URL?.trim() || `ws://localhost:${port}`
  const tlsCertFile = env.RELAY_TLS_CERT_FILE?.trim()
  const tlsKeyFile = env.RELAY_TLS_KEY_FILE?.trim()
  const tlsCert = readOptionalFile(tlsCertFile)
  const tlsKey = readOptionalFile(tlsKeyFile)
  const adminToken = env.RELAY_ADMIN_TOKEN?.trim()
  const accessToken = env.RELAY_ACCESS_TOKEN?.trim()
  if (!accessToken) {
    throw new Error('RELAY_ACCESS_TOKEN is required')
  }
  const certificateDiscovery = loadCertificateDiscovery(env, tlsCertFile)
  const maxConnectionsPerIpPerMinute =
    parsePositiveInt(env.RELAY_MAX_CONN_PER_IP_PER_MIN) ??
    RELAY_DEFAULT_MAX_CONNECTIONS_PER_IP_PER_MINUTE
  const maxConcurrentConnections =
    parsePositiveInt(env.RELAY_MAX_CONCURRENT_CONNECTIONS) ??
    RELAY_DEFAULT_MAX_CONCURRENT_CONNECTIONS
  const trustProxy =
    env.RELAY_TRUST_PROXY?.trim() === '1' || env.RELAY_TRUST_PROXY?.trim() === 'true'

  const config: RelayConfig = {
    host,
    port,
    publicUrl,
    storePath,
    v2StorePath,
    accessToken,
    maxConnectionsPerIpPerMinute,
    maxConcurrentConnections,
    trustProxy
  }
  if (adminToken) {
    config.adminToken = adminToken
  }
  if (certificateDiscovery) {
    config.certificateDiscovery = certificateDiscovery
  }
  // Why: exactOptionalPropertyTypes — only attach TLS keys when both are present
  // so an `undefined` does not satisfy the optional-but-present contract.
  if (tlsCert && tlsKey) {
    return { ...config, tlsCert, tlsKey }
  }
  return config
}

function parsePort(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    return null
  }
  return port
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function defaultStorePath(): string {
  return join(homedir(), '.orca-relay', 'rooms.json')
}

function defaultV2StorePath(storePath: string): string {
  return join(dirname(storePath), 'relay-v2.json')
}

function readOptionalFile(path: string | undefined): string | undefined {
  if (!path) {
    return undefined
  }
  return readFileSync(path, 'utf-8')
}
