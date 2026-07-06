import type { WebSocket } from 'ws'
import { RelayCloseCode } from '../protocol.js'
import { buildRelayV2InvitePayload } from './relay-v2-invite-payload.js'
import type { RelayV2MobilePresence } from './relay-v2-mobile-presence.js'
import type { ChannelCreateMessage } from './relay-v2-protocol.js'
import { closeWithCode, sendRelayV2, type RelayV2SocketRegistry } from './relay-v2-socket.js'
import type { RelayV2Store } from './relay-v2-store.js'

export function handleRelayV2ChannelCreate(input: {
  ws: WebSocket
  pcId: string
  message: ChannelCreateMessage
  store: RelayV2Store
  sockets: RelayV2SocketRegistry
  presence: RelayV2MobilePresence
  publicUrl: string
  channelInviteTtlMs: number
  serverCaSha256: string
  serverCaDerB64: string
  revokeMobilesForPc: (pcId: string) => void
  setChannelId: (channelId: string) => void
}): void {
  const mobile = input.presence.currentForPc(input.pcId)
  if (mobile && input.message.mode === 'keep-existing') {
    sendRelayV2(input.ws, {
      type: 'channel-create-requires-confirmation',
      mobileDeviceId: mobile.mobileDeviceId,
      mobileName: mobile.mobileName,
      mobileState: mobile.state,
      lastSeenAt: mobile.lastSeenAt
    })
    return
  }
  if (input.message.mode === 'disconnect-existing') {
    input.revokeMobilesForPc(input.pcId)
  }
  const created = input.store.createChannel(input.pcId, input.channelInviteTtlMs)
  const pc = input.store.getPc(input.pcId)
  if (!created || !pc) {
    closeWithCode(input.ws, RelayCloseCode.Unauthorized, 'pc unavailable')
    return
  }
  input.setChannelId(created.channel.channelId)
  input.sockets.attachPcToChannel(created.channel.channelId, input.sockets.pc(input.pcId))
  sendRelayV2(input.ws, {
    type: 'channel-created',
    channelId: created.channel.channelId,
    inviteToken: created.inviteToken,
    expiresAt: created.channel.expiresAt,
    qrPayload: buildRelayV2InvitePayload({
      relayUrl: input.publicUrl,
      pcId: pc.pcId,
      channelId: created.channel.channelId,
      inviteToken: created.inviteToken,
      pcPublicKeyB64: pc.publicKeyB64,
      serverCaSha256: input.serverCaSha256,
      serverCaDerB64: input.serverCaDerB64
    })
  })
}
