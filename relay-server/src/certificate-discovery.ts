import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type RelayCertificateDiscovery = {
  caCertDer: Buffer
  caMobileConfig: string
  certificateToken: string
  caSha256B64: string
}

const CA_CERT_FILE_NAME = 'orca-relay-ca.cer'
const CA_MOBILECONFIG_FILE_NAME = 'orca-relay-ca.mobileconfig'
const CA_TOKEN_FILE_NAME = 'orca-relay-ca.token'

export function loadCertificateDiscovery(
  env: NodeJS.ProcessEnv,
  tlsCertFile: string | undefined
): RelayCertificateDiscovery | undefined {
  const defaultDir = tlsCertFile ? dirname(tlsCertFile) : undefined
  const caCertPath = configuredPath(env.RELAY_CA_CERT_FILE, defaultDir, CA_CERT_FILE_NAME)
  const mobileConfigPath = configuredPath(
    env.RELAY_CA_MOBILECONFIG_FILE,
    defaultDir,
    CA_MOBILECONFIG_FILE_NAME
  )
  const tokenPath = configuredPath(env.RELAY_CERT_TOKEN_FILE, defaultDir, CA_TOKEN_FILE_NAME)
  const hasExplicitDiscoveryPath =
    hasValue(env.RELAY_CA_CERT_FILE) ||
    hasValue(env.RELAY_CA_MOBILECONFIG_FILE) ||
    hasValue(env.RELAY_CERT_TOKEN_FILE)

  if (!caCertPath && !mobileConfigPath && !tokenPath) {
    return undefined
  }
  if (!hasExplicitDiscoveryPath && (!caCertPath || !mobileConfigPath || !tokenPath)) {
    return undefined
  }
  if (!caCertPath || !mobileConfigPath || !tokenPath) {
    throw new Error(
      'Certificate discovery requires RELAY_CA_CERT_FILE, RELAY_CA_MOBILECONFIG_FILE, and RELAY_CERT_TOKEN_FILE'
    )
  }

  const caCertDer = readFileSync(caCertPath)
  return {
    caCertDer,
    caMobileConfig: readFileSync(mobileConfigPath, 'utf8'),
    certificateToken: readFileSync(tokenPath, 'utf8').trim(),
    caSha256B64: createHash('sha256').update(caCertDer).digest('base64')
  }
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

function configuredPath(
  explicitPath: string | undefined,
  defaultDir: string | undefined,
  fileName: string
): string | undefined {
  const explicit = explicitPath?.trim()
  if (explicit) {
    return explicit
  }
  if (!defaultDir) {
    return undefined
  }
  const fallback = join(defaultDir, fileName)
  return existsSync(fallback) ? fallback : undefined
}
