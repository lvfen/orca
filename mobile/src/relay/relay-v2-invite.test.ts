import { describe, expect, it } from 'vitest'
import {
  RELAY_V2_PROTOCOL_VERSION,
  decodeRelayV2Invite,
  parseRelayV2ServerMessage
} from './relay-v2-invite'
import { buildRelayV2CertificateMobileConfig } from './relay-v2-certificate-profile'

const invite = {
  v: RELAY_V2_PROTOCOL_VERSION,
  type: 'orca-relay-invite',
  relayUrl: 'wss://relay.example.com',
  pcId: 'pc_1',
  channelId: 'ch_1',
  inviteToken: 'invite',
  pcPublicKeyB64: 'pc-public',
  serverCaSha256: 'sha',
  serverCaDerB64: 'Y2VydA==',
  deviceToken: 'device-token'
} as const

describe('decodeRelayV2Invite', () => {
  it('decodes a relay v2 invite payload', () => {
    expect(decodeRelayV2Invite(JSON.stringify(invite))).toEqual(invite)
  })

  it('decodes a compact relay v2 invite QR payload', () => {
    expect(
      decodeRelayV2Invite(
        JSON.stringify({
          v: 2,
          t: 'r',
          u: invite.relayUrl,
          p: invite.pcId,
          c: invite.channelId,
          i: invite.inviteToken,
          k: invite.pcPublicKeyB64,
          h: invite.serverCaSha256,
          a: invite.serverCaDerB64,
          d: invite.deviceToken
        })
      )
    ).toEqual(invite)
  })

  it('rejects malformed invite payloads', () => {
    expect(decodeRelayV2Invite('not-json')).toBeNull()
    expect(decodeRelayV2Invite(JSON.stringify({ ...invite, v: 1 }))).toBeNull()
    expect(decodeRelayV2Invite(JSON.stringify({ ...invite, deviceToken: '' }))).toBeNull()
    const { deviceToken: _deviceToken, ...missingDeviceToken } = invite
    expect(decodeRelayV2Invite(JSON.stringify(missingDeviceToken))).toBeNull()
  })
})

describe('parseRelayV2ServerMessage', () => {
  it('parses bind and resume acknowledgements', () => {
    expect(
      parseRelayV2ServerMessage(
        JSON.stringify({
          type: 'mobile-bind-ack',
          pcId: 'pc_1',
          mobileDeviceId: 'mobile_1',
          resumeToken: 'resume',
          resumeTokenExpiresAt: 123
        })
      )
    ).toMatchObject({ type: 'mobile-bind-ack', resumeToken: 'resume' })
    expect(
      parseRelayV2ServerMessage(
        JSON.stringify({
          type: 'mobile-resume-ack',
          pcId: 'pc_1',
          mobileDeviceId: 'mobile_1'
        })
      )
    ).toEqual({ type: 'mobile-resume-ack', pcId: 'pc_1', mobileDeviceId: 'mobile_1' })
  })
})

describe('buildRelayV2CertificateMobileConfig', () => {
  it('embeds the relay CA DER in an iOS profile', () => {
    const profile = buildRelayV2CertificateMobileConfig({
      invite,
      profileUuid: '11111111-1111-4111-8111-111111111111',
      certificateUuid: '22222222-2222-4222-8222-222222222222'
    })

    expect(profile).toContain('<key>PayloadType</key>')
    expect(profile).toContain('com.apple.security.root')
    expect(profile).toContain('Y2VydA==')
    expect(profile).toContain('relay.example.com')
  })
})
