import { describe, expect, it } from 'vitest'
import {
  isRelayInviteV2Payload,
  parseRelayV2ClientMessage,
  RELAY_V2_PROTOCOL_VERSION
} from '../src/v2/relay-v2-protocol.js'

describe('relay v2 protocol', () => {
  it('parses PC control messages', () => {
    expect(
      parseRelayV2ClientMessage(
        JSON.stringify({
          type: 'pc-hello',
          v: 2,
          pcId: 'pc_1',
          pcName: 'MacBook Pro',
          pcSecret: 'secret',
          accessToken: 'test-access-token',
          publicKeyB64: 'pub'
        })
      )
    ).toEqual({
      type: 'pc-hello',
      v: RELAY_V2_PROTOCOL_VERSION,
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'secret',
      accessToken: 'test-access-token',
      publicKeyB64: 'pub'
    })

    expect(
      parseRelayV2ClientMessage(JSON.stringify({ type: 'channel-create', mode: 'keep-existing' }))
    ).toEqual({ type: 'channel-create', mode: 'keep-existing' })
  })

  it('parses mobile join and resume messages', () => {
    expect(
      parseRelayV2ClientMessage(
        JSON.stringify({
          type: 'mobile-join',
          v: 2,
          channelId: 'ch_1',
          inviteToken: 'invite',
          mobileDeviceId: 'mobile_1',
          mobileName: 'iPhone'
        })
      )
    ).toEqual({
      type: 'mobile-join',
      v: RELAY_V2_PROTOCOL_VERSION,
      channelId: 'ch_1',
      inviteToken: 'invite',
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone'
    })

    expect(
      parseRelayV2ClientMessage(
        JSON.stringify({
          type: 'mobile-resume',
          v: 2,
          pcId: 'pc_1',
          mobileDeviceId: 'mobile_1',
          resumeToken: 'resume'
        })
      )
    ).toEqual({
      type: 'mobile-resume',
      v: RELAY_V2_PROTOCOL_VERSION,
      pcId: 'pc_1',
      mobileDeviceId: 'mobile_1',
      resumeToken: 'resume'
    })
  })

  it('rejects malformed client messages', () => {
    expect(parseRelayV2ClientMessage('not-json')).toBeNull()
    expect(parseRelayV2ClientMessage(JSON.stringify({ type: 'pc-hello', v: 1 }))).toBeNull()
    expect(
      parseRelayV2ClientMessage(JSON.stringify({ type: 'channel-create', mode: 'x' }))
    ).toBeNull()
    expect(
      parseRelayV2ClientMessage(
        JSON.stringify({
          type: 'mobile-join',
          v: 2,
          channelId: 'ch_1',
          inviteToken: '',
          mobileDeviceId: 'mobile_1',
          mobileName: 'iPhone'
        })
      )
    ).toBeNull()
    expect(parseRelayV2ClientMessage(JSON.stringify({ type: 'unknown' }))).toBeNull()
  })

  it('validates relay invite payloads', () => {
    expect(
      isRelayInviteV2Payload({
        v: 2,
        type: 'orca-relay-invite',
        relayUrl: 'wss://relay.example.com',
        pcId: 'pc_1',
        channelId: 'ch_1',
        inviteToken: 'invite',
        pcPublicKeyB64: 'pub',
        serverCaSha256: 'sha',
        serverCaDerB64: 'der'
      })
    ).toBe(true)

    expect(
      isRelayInviteV2Payload({
        v: 2,
        type: 'orca-relay-invite',
        relayUrl: 'wss://relay.example.com',
        pcId: 'pc_1'
      })
    ).toBe(false)
  })
})
