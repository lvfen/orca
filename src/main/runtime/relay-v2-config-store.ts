import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { DesktopRelaySettings } from '../../shared/relay-v2-desktop'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'

const RELAY_V2_CONFIG_FILENAME = 'orca-relay-v2-config.json'
const RELAY_V2_CONFIG_VERSION = 1
const MAX_RELAY_V2_CONFIG_FILE_BYTES = 16 * 1024

export type RelayV2Config = {
  v: typeof RELAY_V2_CONFIG_VERSION
  relayUrl: string
  pcId: string
  pcSecret: string
  pcName: string
  serverCaDerB64?: string
}

export function defaultRelayV2PcName(): string {
  const name = hostname().trim()
  return name.length > 0 ? name : 'Orca Desktop'
}

export function loadRelayV2Config(userDataPath: string): RelayV2Config | null {
  const path = relayV2ConfigPath(userDataPath)
  if (!existsSync(path)) {
    return null
  }
  try {
    hardenExistingSecureFile(path)
    if (statSync(path).size > MAX_RELAY_V2_CONFIG_FILE_BYTES) {
      return null
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return isRelayV2Config(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveRelayV2Config(userDataPath: string, config: RelayV2Config): void {
  writeSecureJsonFile(relayV2ConfigPath(userDataPath), config)
}

export function clearRelayV2Config(userDataPath: string): void {
  rmSync(relayV2ConfigPath(userDataPath), { force: true })
}

export function createRelayV2Config(
  relayUrl: string,
  pcName = defaultRelayV2PcName()
): RelayV2Config {
  return {
    v: RELAY_V2_CONFIG_VERSION,
    relayUrl,
    pcId: `pc_${randomBytes(12).toString('base64url')}`,
    pcSecret: randomBytes(32).toString('base64url'),
    pcName
  }
}

export function toDesktopRelaySettings(config: RelayV2Config | null): DesktopRelaySettings {
  return {
    relayUrl: config?.relayUrl ?? null,
    pcId: config?.pcId ?? null,
    pcName: config?.pcName ?? defaultRelayV2PcName()
  }
}

export function normalizeRelayV2Url(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `wss://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    return null
  }
  if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:'
  } else if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:'
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return null
  }
  if (!parsed.hostname) {
    return null
  }
  parsed.hash = ''
  return parsed.toString()
}

function relayV2ConfigPath(userDataPath: string): string {
  return join(userDataPath, RELAY_V2_CONFIG_FILENAME)
}

function isRelayV2Config(value: unknown): value is RelayV2Config {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    candidate.v === RELAY_V2_CONFIG_VERSION &&
    typeof candidate.relayUrl === 'string' &&
    normalizeRelayV2Url(candidate.relayUrl) === candidate.relayUrl &&
    typeof candidate.pcId === 'string' &&
    candidate.pcId.length > 0 &&
    typeof candidate.pcSecret === 'string' &&
    candidate.pcSecret.length > 0 &&
    typeof candidate.pcName === 'string' &&
    candidate.pcName.length > 0 &&
    (candidate.serverCaDerB64 === undefined ||
      (typeof candidate.serverCaDerB64 === 'string' && candidate.serverCaDerB64.length > 0))
  )
}
