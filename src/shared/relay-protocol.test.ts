import { describe, expect, it } from 'vitest'
import {
  RelayCloseCode,
  encodeClientJoin,
  encodeHostJoin,
  isTerminalCloseCode,
  parseRelayControlFrame
} from './relay-protocol'

describe('relay protocol', () => {
  it('encodes join frames', () => {
    expect(JSON.parse(encodeHostJoin('tok'))).toEqual({ type: 'host-join', token: 'tok' })
    expect(JSON.parse(encodeClientJoin('tok'))).toEqual({ type: 'client-join', token: 'tok' })
  })

  it('parses every known relay control frame', () => {
    for (const type of ['host-join-ack', 'room-ready', 'host-offline', 'peer-online']) {
      expect(parseRelayControlFrame(JSON.stringify({ type }))?.type).toBe(type)
    }
  })

  it('does not mistake E2EE/RPC frames for control frames', () => {
    expect(
      parseRelayControlFrame(JSON.stringify({ type: 'e2ee_hello', publicKeyB64: 'x' }))
    ).toBeNull()
    expect(parseRelayControlFrame(JSON.stringify({ type: 'e2ee_ready' }))).toBeNull()
    expect(parseRelayControlFrame(JSON.stringify({ id: 'abc', method: 'status.get' }))).toBeNull()
    expect(parseRelayControlFrame('dGhpcyBpcyBjaXBoZXJ0ZXh0')).toBeNull()
    expect(parseRelayControlFrame('not json')).toBeNull()
    expect(parseRelayControlFrame('"a string"')).toBeNull()
    expect(parseRelayControlFrame('null')).toBeNull()
  })

  it('classifies terminal vs recoverable close codes', () => {
    expect(isTerminalCloseCode(RelayCloseCode.Occupied)).toBe(true)
    expect(isTerminalCloseCode(RelayCloseCode.Unauthorized)).toBe(true)
    expect(isTerminalCloseCode(RelayCloseCode.PeerRecycled)).toBe(false)
    expect(isTerminalCloseCode(1006)).toBe(false)
    expect(isTerminalCloseCode(1000)).toBe(false)
  })
})
