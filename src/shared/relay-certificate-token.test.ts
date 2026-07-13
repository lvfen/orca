import { describe, expect, it } from 'vitest'
import { decodeRelayCertificateToken } from './relay-certificate-token'

function encodeCertificate(payload: object): string {
  return `orca-cert_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

describe('relay certificate token', () => {
  const payload = {
    v: 1,
    name: 'Orca Relay 203.0.113.10',
    host: '203.0.113.10',
    relayUrl: 'wss://203.0.113.10:6770',
    caCertDerB64: 'Y2VydA==',
    iosMobileConfigB64: 'cHJvZmlsZQ==',
    sha256B64: 'hash'
  }

  it('decodes a certificate token', () => {
    expect(decodeRelayCertificateToken(encodeCertificate(payload))).toEqual(payload)
  })

  it('rejects malformed certificate tokens', () => {
    expect(decodeRelayCertificateToken('orca-cert_not-json')).toBeNull()
    expect(decodeRelayCertificateToken(encodeCertificate({ v: 1, name: 'x' }))).toBeNull()
    expect(decodeRelayCertificateToken('orca-pc_abc')).toBeNull()
  })
})
