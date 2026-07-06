import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateRelayCertificateBundle,
  normalizeCertificateHost
} from '../src/certificate-authority.js'
import { decodeRelayCertificateToken } from '../src/certificate-token.js'

type BasicConstraintsExtension = {
  cA: boolean
}

type SubjectAltNameExtension = {
  altNames: { type: number; value?: string; ip?: string }[]
}

describe('certificate authority generation', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-certs-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('normalizes hosts from URLs, authorities, and bracketed IPv6 values', () => {
    expect(normalizeCertificateHost('wss://192.0.2.10:6770')).toBe('192.0.2.10')
    expect(normalizeCertificateHost('wss://[2001:db8::10]:6770')).toBe('2001:db8::10')
    expect(normalizeCertificateHost('relay.example.com:6770')).toBe('relay.example.com')
    expect(normalizeCertificateHost('[2001:db8::10]:6770')).toBe('2001:db8::10')
  })

  it('writes a trusted CA, iOS profile, and IP-address server certificate', () => {
    const bundle = generateRelayCertificateBundle({
      host: '192.0.2.10',
      outDir: dir,
      name: 'Test Relay'
    })
    const caCert = readPemCertificate(bundle.caCertPath)
    const serverCert = readPemCertificate(bundle.serverCertPath)
    const caConstraints = getExtension<BasicConstraintsExtension>(caCert, 'basicConstraints')
    const serverConstraints = getExtension<BasicConstraintsExtension>(
      serverCert,
      'basicConstraints'
    )
    const san = getExtension<SubjectAltNameExtension>(serverCert, 'subjectAltName')
    const mobileConfig = readFileSync(bundle.caMobileConfigPath, 'utf8')
    const certificateToken = decodeRelayCertificateToken(bundle.certificateToken)

    expect(bundle.relayUrl).toBe('wss://192.0.2.10:6770')
    expect(existsSync(bundle.caDerPath)).toBe(true)
    expect(readFileSync(bundle.caTokenPath, 'utf8')).toBe(bundle.certificateToken)
    expect(existsSync(bundle.serverKeyPath)).toBe(true)
    expect(caConstraints.cA).toBe(true)
    expect(serverConstraints.cA).toBe(false)
    expect(san.altNames).toContainEqual(expect.objectContaining({ type: 7, ip: '192.0.2.10' }))
    expect(caCert.verify(serverCert)).toBe(true)
    expect(serverCert.getExtension('authorityKeyIdentifier')).toBeNull()
    expect(mobileConfig).toContain('<string>com.apple.security.root</string>')
    expect(mobileConfig).toContain('<string>Configuration</string>')
    expect(mobileConfig).toContain(readFileSync(bundle.caDerPath).toString('base64'))
    expect(certificateToken?.host).toBe('192.0.2.10')
    expect(certificateToken?.iosMobileConfigB64).toBe(
      Buffer.from(mobileConfig, 'utf8').toString('base64')
    )
  })

  it('writes owner-only private material on POSIX', () => {
    if (process.platform === 'win32') {
      return
    }
    const bundle = generateRelayCertificateBundle({ host: 'relay.example.com', outDir: dir })

    expect(statSync(bundle.serverKeyPath).mode & 0o777).toBe(0o600)
    expect(statSync(bundle.caCertPath).mode & 0o777).toBe(0o600)
    expect(statSync(bundle.caTokenPath).mode & 0o777).toBe(0o600)
  })
})

function readPemCertificate(path: string): forge.pki.Certificate {
  return forge.pki.certificateFromPem(readFileSync(path, 'utf8'))
}

function getExtension<T>(cert: forge.pki.Certificate, name: string): T {
  const extension = cert.getExtension(name)
  if (!extension) {
    throw new Error(`Missing certificate extension: ${name}`)
  }
  return extension as T
}
