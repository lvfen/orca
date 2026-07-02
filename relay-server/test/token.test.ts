import { describe, expect, it } from 'vitest'
import {
  decodeToken,
  encodeToken,
  generateRoomId,
  generateTokenPair,
  tokensEqual,
  type TokenPayload
} from '../src/token.js'

describe('token codec', () => {
  const payload: TokenPayload = {
    relayUrl: 'wss://relay.example.com',
    roomId: 'room-abc',
    secret: 'super-secret-value'
  }

  it('round-trips a host token with the orca-pc_ prefix', () => {
    const token = encodeToken('host', payload)
    expect(token.startsWith('orca-pc_')).toBe(true)
    const decoded = decodeToken(token)
    expect(decoded).not.toBeNull()
    expect(decoded?.role).toBe('host')
    expect(decoded?.payload).toEqual(payload)
  })

  it('round-trips a client token with the orca-mb_ prefix', () => {
    const token = encodeToken('client', payload)
    expect(token.startsWith('orca-mb_')).toBe(true)
    const decoded = decodeToken(token)
    expect(decoded?.role).toBe('client')
    expect(decoded?.payload).toEqual(payload)
  })

  it('rejects tokens without a known prefix', () => {
    expect(decodeToken('nope_abc')).toBeNull()
  })

  it('rejects tokens with a malformed body', () => {
    expect(decodeToken('orca-pc_!!!notbase64json')).toBeNull()
  })

  it('rejects tokens missing required fields', () => {
    const partial = Buffer.from(JSON.stringify({ roomId: 'x' }), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(decodeToken(`orca-pc_${partial}`)).toBeNull()
  })

  it('generates a matched pair sharing one roomId and secret', () => {
    const roomId = generateRoomId()
    const pair = generateTokenPair('wss://r.example.com', roomId)
    const pc = decodeToken(pair.pcToken)
    const mb = decodeToken(pair.mobileToken)
    expect(pc?.role).toBe('host')
    expect(mb?.role).toBe('client')
    expect(pc?.payload.roomId).toBe(roomId)
    expect(mb?.payload.roomId).toBe(roomId)
    expect(pc?.payload.secret).toBe(mb?.payload.secret)
  })

  it('compares tokens in constant time by value', () => {
    const a = encodeToken('host', payload)
    expect(tokensEqual(a, a)).toBe(true)
    expect(tokensEqual(a, `${a}x`)).toBe(false)
    expect(tokensEqual(a, encodeToken('client', payload))).toBe(false)
  })
})
