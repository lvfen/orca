import type { RelayInviteV2Payload } from './relay-v2-protocol.js'
import { RELAY_V2_PROTOCOL_VERSION } from './relay-v2-protocol.js'

export type RelayV2InvitePayloadInput = {
  relayUrl: string
  pcId: string
  channelId: string
  inviteToken: string
  pcPublicKeyB64: string
  serverCaSha256: string
  serverCaDerB64: string
}

export function buildRelayV2InvitePayload(input: RelayV2InvitePayloadInput): RelayInviteV2Payload {
  return {
    v: RELAY_V2_PROTOCOL_VERSION,
    type: 'orca-relay-invite',
    relayUrl: input.relayUrl,
    pcId: input.pcId,
    channelId: input.channelId,
    inviteToken: input.inviteToken,
    pcPublicKeyB64: input.pcPublicKeyB64,
    serverCaSha256: input.serverCaSha256,
    serverCaDerB64: input.serverCaDerB64
  }
}
