import { describe, expect, it } from 'vitest'
import {
  buildRelayCertificateDiscoveryUrl,
  validateRelayCertificateTokenForUrl
} from './relay-certificate-discovery'

function encodeCertificate(payload: object): string {
  return `orca-cert_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

describe('relay certificate discovery', () => {
  const payload = {
    v: 1,
    name: 'Orca Relay 203.0.113.10',
    host: '203.0.113.10',
    relayUrl: 'wss://203.0.113.10:6770',
    caCertDerB64: 'Y2VydA==',
    iosMobileConfigB64: 'cHJvZmlsZQ==',
    sha256B64: 'hash'
  }

  it('builds the well-known certificate token URL from a relay websocket URL', () => {
    expect(buildRelayCertificateDiscoveryUrl('wss://203.0.113.10:6770')).toBe(
      'https://203.0.113.10:6770/.well-known/orca-relay/cert-token'
    )
    expect(buildRelayCertificateDiscoveryUrl('ws://relay.example.com')).toBe(
      'http://relay.example.com/.well-known/orca-relay/cert-token'
    )
    expect(buildRelayCertificateDiscoveryUrl('https://relay.example.com')).toBeNull()
  })

  it('accepts only certificate tokens for the requested relay URL', () => {
    const token = encodeCertificate(payload)
    expect(validateRelayCertificateTokenForUrl(token, 'wss://203.0.113.10:6770')).toEqual({
      ok: true,
      token
    })
    expect(validateRelayCertificateTokenForUrl(token, 'wss://203.0.113.11:6770')).toEqual({
      ok: false,
      reason: 'relay-url-mismatch'
    })
    expect(
      validateRelayCertificateTokenForUrl('orca-cert_not-json', 'wss://203.0.113.10:6770')
    ).toEqual({ ok: false, reason: 'invalid-token' })
  })
})
