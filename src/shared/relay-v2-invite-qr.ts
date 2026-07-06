import type { RelayInviteV2Payload } from './relay-v2-protocol-types'

export type CompactRelayV2InvitePayload = {
  v: 2
  t: 'r'
  u: string
  p: string
  c: string
  i: string
  k: string
  h: string
  a: string
  d?: string
}

export function encodeRelayV2InviteQrPayload(payload: RelayInviteV2Payload): string {
  return JSON.stringify({
    v: 2,
    t: 'r',
    u: payload.relayUrl,
    p: payload.pcId,
    c: payload.channelId,
    i: payload.inviteToken,
    k: payload.pcPublicKeyB64,
    h: payload.serverCaSha256,
    a: payload.serverCaDerB64,
    d: payload.deviceToken
  } satisfies CompactRelayV2InvitePayload)
}
