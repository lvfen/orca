import { describe, expect, it } from 'vitest'
import { decodePcToken, decodeRelayToken } from './relay-token'

function encode(role: 'host' | 'client', payload: object): string {
  const prefix = role === 'host' ? 'orca-pc_' : 'orca-mb_'
  return prefix + Buffer.from(JSON.stringify(payload)).toString('base64url')
}

describe('relay token', () => {
  const payload = { relayUrl: 'wss://relay.example.com', roomId: 'room-123', secret: 'sekret' }

  it('decodes a host (PC) token', () => {
    expect(decodeRelayToken(encode('host', payload))).toEqual({ role: 'host', payload })
  })

  it('decodes a client (mobile) token', () => {
    const decoded = decodeRelayToken(encode('client', payload))
    expect(decoded?.role).toBe('client')
    expect(decoded?.payload.relayUrl).toBe(payload.relayUrl)
  })

  it('decodePcToken accepts a PC token and rejects a mobile token', () => {
    expect(decodePcToken(encode('host', payload))?.role).toBe('host')
    expect(decodePcToken(encode('client', payload))).toBeNull()
  })

  it('rejects unknown prefixes', () => {
    expect(decodeRelayToken(`nope_${Buffer.from('{}').toString('base64url')}`)).toBeNull()
    expect(decodeRelayToken('')).toBeNull()
  })

  it('rejects malformed base64/JSON bodies', () => {
    expect(decodeRelayToken('orca-pc_!!!not-valid')).toBeNull()
    expect(decodeRelayToken(`orca-pc_${Buffer.from('not json').toString('base64url')}`)).toBeNull()
  })

  it('rejects payloads missing or emptying required fields', () => {
    expect(decodeRelayToken(encode('host', { relayUrl: 'x', roomId: 'y' }))).toBeNull()
    expect(decodeRelayToken(encode('host', { relayUrl: '', roomId: 'y', secret: 'z' }))).toBeNull()
    expect(decodeRelayToken(encode('host', { relayUrl: 'x', roomId: '', secret: 'z' }))).toBeNull()
  })
})
