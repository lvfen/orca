import { describe, expect, it } from 'vitest'
import { RelayCloseCode, encodeClientJoin, parseRelayControlFrame } from './relay-protocol'

describe('encodeClientJoin', () => {
  it('encodes a client-join control frame', () => {
    expect(JSON.parse(encodeClientJoin('orca-mb_abc'))).toEqual({
      type: 'client-join',
      token: 'orca-mb_abc'
    })
  })
})

describe('parseRelayControlFrame', () => {
  it('recognizes every relay control type', () => {
    for (const type of ['host-join-ack', 'room-ready', 'host-offline', 'peer-online']) {
      expect(parseRelayControlFrame(JSON.stringify({ type }))).toEqual({ type })
    }
  })

  it('ignores E2EE/RPC frames and junk', () => {
    expect(parseRelayControlFrame('not json')).toBeNull()
    expect(parseRelayControlFrame(JSON.stringify({ type: 'e2ee_ready' }))).toBeNull()
    expect(parseRelayControlFrame(JSON.stringify({ id: 'rpc-1', ok: true }))).toBeNull()
    expect(parseRelayControlFrame(JSON.stringify({ type: 'unknown' }))).toBeNull()
    expect(parseRelayControlFrame(JSON.stringify(['room-ready']))).toBeNull()
  })
})

describe('RelayCloseCode', () => {
  it('pins the wire contract close codes', () => {
    expect(RelayCloseCode.Occupied).toBe(4409)
    expect(RelayCloseCode.PeerRecycled).toBe(4408)
    expect(RelayCloseCode.Unauthorized).toBe(4401)
    expect(RelayCloseCode.BadJoin).toBe(4400)
  })
})
