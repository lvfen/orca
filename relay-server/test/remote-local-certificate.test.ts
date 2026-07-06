import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateRelayCertificateBundle } from '../src/certificate-authority.js'
import { ensureLocalCertificateBundle } from '../src/remote-local-certificate.js'
import type { RemoteRelayDeployConfig } from '../src/remote-properties.js'

describe('ensureLocalCertificateBundle', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-local-cert-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('regenerates a stale bundle when the server cert is not signed by the CA', () => {
    const relayRootDir = dir
    const certDir = join(relayRootDir, 'certs')
    const first = generateRelayCertificateBundle({ host: '203.0.113.10', outDir: certDir })
    const staleServerCert = readFileSync(first.serverCertPath, 'utf8')
    generateRelayCertificateBundle({ host: '203.0.113.10', outDir: certDir })
    writeFileSync(join(certDir, 'orca-relay-server.pem'), staleServerCert)

    const token = ensureLocalCertificateBundle(configForTest(), relayRootDir, { write: () => true })

    expect(token).toMatch(/^orca-cert_/)
    const caCert = readDerCertificate(join(certDir, 'orca-relay-ca.cer'))
    const serverCert = forge.pki.certificateFromPem(
      readFileSync(join(certDir, 'orca-relay-server.pem'), 'utf8')
    )
    expect(caCert.verify(serverCert)).toBe(true)
    expect(existsSync(join(certDir, 'orca-relay-ca.token'))).toBe(true)
  })
})

function readDerCertificate(path: string): forge.pki.Certificate {
  const der = readFileSync(path).toString('binary')
  return forge.pki.certificateFromAsn1(forge.asn1.fromDer(der))
}

function configForTest(): RemoteRelayDeployConfig {
  return {
    sourcePath: '/tmp/remote.properties',
    host: '203.0.113.10',
    port: 22,
    username: 'deploy',
    remoteDir: '/srv/orca-relay',
    uploadPaths: ['dist', 'package.json', 'certs'],
    localBuildCommand: 'npm run build',
    remoteInstallCommand: 'npm install --omit=dev --no-audit --no-fund',
    remoteNodeCommand: 'node',
    remotePidFile: '/srv/orca-relay/relay.pid',
    remoteLogFile: '/srv/orca-relay/relay.log',
    relayEnv: { RELAY_PUBLIC_URL: 'wss://203.0.113.10:6770' },
    domain: null,
    localCertificate: { enabled: true, host: '203.0.113.10', outDir: 'certs' }
  }
}
