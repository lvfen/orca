import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { join } from 'node:path'
import forge from 'node-forge'
import { buildRelayCertificateToken } from './certificate-token.js'
import { createIosCaMobileConfig } from './ios-ca-mobileconfig.js'
import { writeOwnerOnlyFile } from './secure-file.js'

const DEFAULT_CA_DAYS = 3650
// Why: Apple clients reject overly long server TLS certificates even when the
// root is user-installed. Keep the generated leaf cert under the 825-day cap.
const DEFAULT_SERVER_DAYS = 397
const BACKDATE_MS = 5 * 60 * 1000

export type RelayCertificateBundleOptions = {
  host: string
  outDir: string
  name?: string
  caDays?: number
  serverDays?: number
  relayUrl?: string
}

export type RelayCertificateBundle = {
  host: string
  displayName: string
  caCertPath: string
  caDerPath: string
  caMobileConfigPath: string
  caTokenPath: string
  serverCertPath: string
  serverKeyPath: string
  relayUrl: string
  certificateToken: string
}

type GeneratedCertificateMaterial = {
  caCertPem: string
  caCertDer: Buffer
  caMobileConfig: string
  serverCertPem: string
  serverKeyPem: string
}

type CertificateAltName = { type: 2; value: string } | { type: 7; ip: string }

export function generateRelayCertificateBundle(
  options: RelayCertificateBundleOptions
): RelayCertificateBundle {
  const host = normalizeCertificateHost(options.host)
  const displayName = options.name?.trim() || `Orca Relay ${host}`
  const caDays = normalizePositiveInt(options.caDays, DEFAULT_CA_DAYS)
  const serverDays = normalizePositiveInt(options.serverDays, DEFAULT_SERVER_DAYS)
  const material = createCertificateMaterial({ host, displayName, caDays, serverDays })
  const paths = certificateBundlePaths(options.outDir)
  const relayUrl = options.relayUrl ?? `wss://${hostForUrl(host)}:6770`
  const certificateToken = buildRelayCertificateToken({
    name: displayName,
    host,
    relayUrl,
    caCertDer: material.caCertDer,
    iosMobileConfig: material.caMobileConfig
  })

  writeOwnerOnlyFile(paths.caCertPath, material.caCertPem)
  writeOwnerOnlyFile(paths.caDerPath, material.caCertDer)
  writeOwnerOnlyFile(paths.caMobileConfigPath, material.caMobileConfig)
  writeOwnerOnlyFile(paths.caTokenPath, certificateToken)
  writeOwnerOnlyFile(paths.serverCertPath, material.serverCertPem)
  writeOwnerOnlyFile(paths.serverKeyPath, material.serverKeyPem)

  return {
    host,
    displayName,
    ...paths,
    relayUrl,
    certificateToken
  }
}

export function normalizeCertificateHost(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error('A host or IP address is required')
  }
  const fromUrl = hostFromUrl(trimmed)
  const host = fromUrl ?? hostFromAuthority(trimmed)
  if (!host || /[\s/]/.test(host) || host.includes('[') || host.includes(']')) {
    throw new Error(`Invalid certificate host: ${input}`)
  }
  return host
}

function createCertificateMaterial(input: {
  host: string
  displayName: string
  caDays: number
  serverDays: number
}): GeneratedCertificateMaterial {
  const caKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
  const serverKeys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 })
  const caCert = createCaCertificate(caKeys, input.displayName, input.caDays)
  const serverCert = createServerCertificate({
    host: input.host,
    serverKeys,
    caCert,
    caPrivateKey: caKeys.privateKey,
    days: input.serverDays
  })
  const caCertDer = certificateToDer(caCert)

  return {
    caCertPem: forge.pki.certificateToPem(caCert),
    caCertDer,
    caMobileConfig: createIosCaMobileConfig({
      displayName: input.displayName,
      certificateDer: caCertDer
    }),
    serverCertPem: forge.pki.certificateToPem(serverCert),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey)
  }
}

function createCaCertificate(
  keys: forge.pki.rsa.KeyPair,
  displayName: string,
  days: number
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = createSerialNumber()
  cert.validity.notBefore = new Date(Date.now() - BACKDATE_MS)
  cert.validity.notAfter = daysFromNow(days)
  const attrs = [
    { name: 'commonName', value: `${displayName} Root CA` },
    { name: 'organizationName', value: 'Orca Relay' }
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return cert
}

function createServerCertificate(input: {
  host: string
  serverKeys: forge.pki.rsa.KeyPair
  caCert: forge.pki.Certificate
  caPrivateKey: forge.pki.rsa.PrivateKey
  days: number
}): forge.pki.Certificate {
  const cert = forge.pki.createCertificate()
  cert.publicKey = input.serverKeys.publicKey
  cert.serialNumber = createSerialNumber()
  cert.validity.notBefore = new Date(Date.now() - BACKDATE_MS)
  cert.validity.notAfter = daysFromNow(input.days)
  cert.setSubject([{ name: 'commonName', value: input.host }])
  cert.setIssuer(input.caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: altNamesForHost(input.host) },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(input.caPrivateKey, forge.md.sha256.create())
  return cert
}

export function certificateBundlePaths(
  outDir: string
): Omit<RelayCertificateBundle, 'host' | 'displayName' | 'relayUrl' | 'certificateToken'> {
  return {
    caCertPath: join(outDir, 'orca-relay-ca.pem'),
    caDerPath: join(outDir, 'orca-relay-ca.cer'),
    caMobileConfigPath: join(outDir, 'orca-relay-ca.mobileconfig'),
    caTokenPath: join(outDir, 'orca-relay-ca.token'),
    serverCertPath: join(outDir, 'orca-relay-server.pem'),
    serverKeyPath: join(outDir, 'orca-relay-server-key.pem')
  }
}

function certificateToDer(cert: forge.pki.Certificate): Buffer {
  const asn1 = forge.pki.certificateToAsn1(cert)
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')
}

function altNamesForHost(host: string): CertificateAltName[] {
  const version = isIP(host)
  if (version !== 0) {
    return [{ type: 7, ip: host }]
  }
  return [{ type: 2, value: host }]
}

function hostFromUrl(value: string): string | null {
  if (!value.includes('://')) {
    return null
  }
  try {
    return hostFromAuthority(new URL(value).hostname)
  } catch {
    throw new Error(`Invalid certificate host URL: ${value}`)
  }
}

function hostFromAuthority(value: string): string {
  if (value.startsWith('[')) {
    const closingIndex = value.indexOf(']')
    return closingIndex === -1 ? value : value.slice(1, closingIndex)
  }
  if (isIP(value) !== 0) {
    return value
  }
  const firstColon = value.indexOf(':')
  if (firstColon !== -1 && firstColon === value.lastIndexOf(':')) {
    return value.slice(0, firstColon)
  }
  return value
}

function hostForUrl(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive day count, got ${value}`)
  }
  return value
}

function createSerialNumber(): string {
  const bytes = randomBytes(16)
  bytes[0] = (bytes[0] ?? 0) & 0x7f || 1
  return bytes.toString('hex')
}
