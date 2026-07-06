import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { posix as posixPath } from 'node:path'
import { parseProperties } from './properties-file.js'
import { parseRelayDomainEndpoint, type RelayDomainEndpoint } from './remote-domain.js'

export { parseProperties } from './properties-file.js'

export type RemoteRelayDeployConfig = {
  sourcePath: string
  host: string
  port: number
  username: string
  password?: string
  privateKeyPath?: string
  passphrase?: string
  agent?: string
  remoteDir: string
  uploadPaths: string[]
  localBuildCommand: string
  remoteInstallCommand: string
  remoteNodeCommand: string
  remotePidFile: string
  remoteLogFile: string
  remoteStopCommand?: string
  remoteStartCommand?: string
  relayEnv: Record<string, string>
  domain: RelayDomainEndpoint | null
  localCertificate: RemoteRelayLocalCertificateConfig
}

export type RemoteRelayLocalCertificateConfig = {
  enabled: boolean
  host: string | null
  outDir: string
  name?: string
}

const DEFAULT_SSH_PORT = 22
const DEFAULT_REMOTE_DIR = '/opt/orca-relay'
const DEFAULT_UPLOAD_PATHS = ['dist', 'package.json', 'pnpm-lock.yaml']

const RELAY_ENV_KEYS: Record<string, string> = {
  'relay.publicUrl': 'RELAY_PUBLIC_URL',
  'relay.host': 'RELAY_HOST',
  'relay.port': 'RELAY_PORT',
  'relay.storePath': 'RELAY_STORE_PATH',
  'relay.v2StorePath': 'RELAY_V2_STORE_PATH',
  'relay.adminToken': 'RELAY_ADMIN_TOKEN',
  'relay.tlsCertFile': 'RELAY_TLS_CERT_FILE',
  'relay.tlsKeyFile': 'RELAY_TLS_KEY_FILE',
  'relay.maxConnPerIpPerMin': 'RELAY_MAX_CONN_PER_IP_PER_MIN',
  'relay.maxConcurrentConnections': 'RELAY_MAX_CONCURRENT_CONNECTIONS',
  'relay.trustProxy': 'RELAY_TRUST_PROXY'
}

export function loadRemoteRelayDeployConfig(configPath: string): RemoteRelayDeployConfig {
  const sourcePath = resolve(configPath)
  return parseRemoteRelayDeployProperties(readFileSync(sourcePath, 'utf8'), sourcePath)
}

export function parseRemoteRelayDeployProperties(
  contents: string,
  sourcePath = 'remote.properties'
): RemoteRelayDeployConfig {
  const properties = parseProperties(contents)
  const domain = readDomain(properties)
  const host = readProperty(properties, ['ssh.host', 'scp.host', 'host']) ?? domain?.host
  if (!host) {
    throw new Error(`${sourcePath} is missing required property: ssh.host`)
  }
  const username = requireProperty(
    properties,
    ['ssh.username', 'ssh.user', 'scp.username', 'scp.user', 'username', 'user'],
    sourcePath
  )
  const port = parsePort(readProperty(properties, ['ssh.port', 'scp.port', 'port']))
  const remoteDir = normalizeRemoteDir(
    readProperty(properties, ['remote.dir', 'remote.path']) ?? DEFAULT_REMOTE_DIR
  )
  const localCertificate = readLocalCertificate(properties, domain)
  const relayEnv = readRelayEnv(properties, domain, remoteDir, localCertificate)
  const uploadPaths = readUploadPaths(properties, localCertificate)
  const localBuildCommand = readProperty(properties, ['local.buildCommand']) ?? 'npm run build'
  const remoteInstallCommand =
    readProperty(properties, ['remote.installCommand']) ??
    'npm install --omit=dev --no-audit --no-fund'
  const remoteNodeCommand = readProperty(properties, ['remote.nodeCommand']) ?? 'node'
  const remotePidFile =
    readProperty(properties, ['remote.pidFile']) ?? `${remoteDir}/relay-server.pid`
  const remoteLogFile = readProperty(properties, ['remote.logFile']) ?? `${remoteDir}/relay.log`
  return {
    sourcePath,
    host,
    port,
    username,
    remoteDir,
    uploadPaths,
    localBuildCommand,
    remoteInstallCommand,
    remoteNodeCommand,
    remotePidFile,
    remoteLogFile,
    relayEnv,
    domain,
    localCertificate,
    ...optionalConfig('password', readProperty(properties, ['ssh.password', 'scp.password'])),
    ...optionalConfig(
      'privateKeyPath',
      readProperty(properties, ['ssh.privateKey', 'ssh.privateKeyPath', 'scp.privateKey'])
    ),
    ...optionalConfig('passphrase', readProperty(properties, ['ssh.passphrase', 'scp.passphrase'])),
    ...optionalConfig('agent', readProperty(properties, ['ssh.agent'])),
    ...optionalConfig('remoteStopCommand', readProperty(properties, ['remote.stopCommand'])),
    ...optionalConfig('remoteStartCommand', readProperty(properties, ['remote.startCommand']))
  }
}

function readDomain(properties: Map<string, string>): RelayDomainEndpoint | null {
  const raw = readProperty(properties, ['domain', 'relay.domain'])
  return raw ? parseRelayDomainEndpoint(raw) : null
}

function readRelayEnv(
  properties: Map<string, string>,
  domain: RelayDomainEndpoint | null,
  remoteDir: string,
  localCertificate: RemoteRelayLocalCertificateConfig
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [propertyKey, envKey] of Object.entries(RELAY_ENV_KEYS)) {
    const value = properties.get(propertyKey)
    if (value !== undefined && value.trim()) {
      env[envKey] = value.trim()
    }
  }
  for (const [key, value] of properties.entries()) {
    if (!key.startsWith('env.')) {
      continue
    }
    const envKey = key.slice('env.'.length)
    if (!/^[A-Z_][A-Z0-9_]*$/.test(envKey)) {
      throw new Error(`Invalid environment variable name in remote.properties: ${envKey}`)
    }
    env[envKey] = value
  }
  if (domain && !env.RELAY_PUBLIC_URL) {
    env.RELAY_PUBLIC_URL = domain.publicUrl
  }
  if (domain?.port && !env.RELAY_PORT) {
    env.RELAY_PORT = String(domain.port)
  }
  if (localCertificate.enabled) {
    env.RELAY_TLS_CERT_FILE ??= posixPath.join(
      remoteDir,
      'current',
      localCertificate.outDir,
      'orca-relay-server.pem'
    )
    env.RELAY_TLS_KEY_FILE ??= posixPath.join(
      remoteDir,
      'current',
      localCertificate.outDir,
      'orca-relay-server-key.pem'
    )
  }
  return env
}

function readLocalCertificate(
  properties: Map<string, string>,
  domain: RelayDomainEndpoint | null
): RemoteRelayLocalCertificateConfig {
  const mode = readProperty(properties, ['cert.mode']) ?? (domain?.isIpAddress ? 'local' : 'none')
  if (mode !== 'local' && mode !== 'none') {
    throw new Error('cert.mode must be local or none')
  }
  const outDir = normalizeUploadPath(readProperty(properties, ['cert.outDir']) ?? 'certs')
  const host = readProperty(properties, ['cert.host']) ?? domain?.host ?? null
  const name = readProperty(properties, ['cert.name'])
  if (mode === 'local' && !host) {
    throw new Error('cert.host is required when cert.mode=local and domain is not set')
  }
  return {
    enabled: mode === 'local',
    host,
    outDir,
    ...(name === undefined ? {} : { name })
  }
}

function readUploadPaths(
  properties: Map<string, string>,
  localCertificate: RemoteRelayLocalCertificateConfig
): string[] {
  const raw = readProperty(properties, ['upload.include', 'upload.paths'])
  const paths = raw ? raw.split(',').map((path) => path.trim()) : DEFAULT_UPLOAD_PATHS
  const normalized = paths.filter(Boolean).map(normalizeUploadPath)
  if (normalized.length === 0) {
    throw new Error('remote.properties upload.include must contain at least one path')
  }
  if (localCertificate.enabled && !normalized.includes(localCertificate.outDir)) {
    normalized.push(localCertificate.outDir)
  }
  return normalized
}

function requireProperty(
  properties: Map<string, string>,
  keys: string[],
  sourcePath: string
): string {
  const value = readProperty(properties, keys)
  if (!value) {
    throw new Error(`${sourcePath} is missing required property: ${keys[0]}`)
  }
  return value
}

function readProperty(properties: Map<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = properties.get(key)?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_SSH_PORT
  }
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid SSH port in remote.properties: ${value}`)
  }
  return port
}

function normalizeRemoteDir(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed.startsWith('/') || trimmed === '') {
    throw new Error('remote.dir must be an absolute POSIX path')
  }
  if (trimmed === '/') {
    throw new Error('remote.dir cannot be /')
  }
  return trimmed
}

function normalizeUploadPath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`upload.include path must be relative: ${value}`)
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`upload.include path cannot contain ..: ${value}`)
  }
  return normalized
}

function optionalConfig<K extends string>(
  key: K,
  value: string | undefined
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}
