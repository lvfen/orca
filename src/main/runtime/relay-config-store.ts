// Why: the relay PC token is a bearer credential (anyone holding it can take the
// host slot on the relay), so it lives in a hardened owner-only file alongside
// the device registry — never in plain settings. This module is the single
// read/write boundary for that persisted token.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { decodePcToken } from '../../shared/relay-token'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'

const RELAY_CONFIG_FILENAME = 'orca-relay-config.json'

type PersistedRelayConfig = {
  pcToken: string
}

function configPath(userDataPath: string): string {
  return join(userDataPath, RELAY_CONFIG_FILENAME)
}

export function loadRelayPcToken(userDataPath: string): string | null {
  const path = configPath(userDataPath)
  if (!existsSync(path)) {
    return null
  }
  try {
    hardenExistingSecureFile(path)
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as PersistedRelayConfig
    // Why: validate the persisted token still decodes as a PC token before
    // trusting it on the startup dial path; a corrupt/rotated file is ignored.
    if (typeof parsed.pcToken !== 'string' || !decodePcToken(parsed.pcToken)) {
      return null
    }
    return parsed.pcToken
  } catch {
    return null
  }
}

export function saveRelayPcToken(userDataPath: string, pcToken: string): void {
  writeSecureJsonFile(configPath(userDataPath), { pcToken } satisfies PersistedRelayConfig)
}

export function clearRelayPcToken(userDataPath: string): void {
  rmSync(configPath(userDataPath), { force: true })
}
