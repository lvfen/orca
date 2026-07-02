import { describe, expect, it } from 'vitest'
import { decodeMobileToken, decodeRelayServerToken } from './relay-token'

function encodeMobileToken(payload: { relayUrl: string; roomId: string; secret: string }): string {
  return `orca-mb_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

describe('decodeMobileToken', () => {
  it('decodes a well-formed mobile token', () => {
    const token = encodeMobileToken({
      relayUrl: 'wss://relay.example.com/room',
      roomId: 'room-123',
      secret: 's3cr3t'
    })
    expect(decodeMobileToken(token)).toEqual({
      relayUrl: 'wss://relay.example.com/room',
      roomId: 'room-123',
      secret: 's3cr3t'
    })
  })

  it('rejects a PC token (wrong prefix)', () => {
    const body = Buffer.from(
      JSON.stringify({ relayUrl: 'wss://r', roomId: 'r', secret: 's' })
    ).toString('base64url')
    expect(decodeMobileToken(`orca-pc_${body}`)).toBeNull()
  })

  it('rejects junk and tokens missing fields', () => {
    expect(decodeMobileToken('not-a-token')).toBeNull()
    expect(decodeMobileToken('orca-mb_!!!notbase64!!!')).toBeNull()
    const missing = `orca-mb_${Buffer.from(JSON.stringify({ relayUrl: 'wss://r', roomId: 'r' })).toString('base64url')}`
    expect(decodeMobileToken(missing)).toBeNull()
    const empty = `orca-mb_${Buffer.from(JSON.stringify({ relayUrl: '', roomId: 'r', secret: 's' })).toString('base64url')}`
    expect(decodeMobileToken(empty)).toBeNull()
  })
})

describe('decodeRelayServerToken', () => {
  it('decodes the desktop server-token QR payload', () => {
    const raw = JSON.stringify({ v: 1, publicKeyB64: 'pub-key', deviceToken: 'dev-token' })
    expect(decodeRelayServerToken(raw)).toEqual({
      publicKeyB64: 'pub-key',
      deviceToken: 'dev-token'
    })
  })

  it('rejects the wrong version, junk, and missing fields', () => {
    expect(decodeRelayServerToken('}{ not json')).toBeNull()
    expect(
      decodeRelayServerToken(JSON.stringify({ v: 2, publicKeyB64: 'p', deviceToken: 'd' }))
    ).toBeNull()
    expect(decodeRelayServerToken(JSON.stringify({ v: 1, publicKeyB64: 'p' }))).toBeNull()
    expect(
      decodeRelayServerToken(JSON.stringify({ v: 1, publicKeyB64: '', deviceToken: 'd' }))
    ).toBeNull()
  })
})
