import type { RawData, WebSocket } from 'ws'
import { RelayCloseCode } from '../protocol.js'
import type { MobileBinding } from './mobile-binding-store.js'
import { RelayV2MobilePresence } from './relay-v2-mobile-presence.js'
import type {
  MobileJoinMessage,
  MobileResumeMessage,
  PcHelloMessage,
  RelayV2ClientMessage
} from './relay-v2-protocol.js'
import { handleRelayV2ChannelCreate } from './relay-v2-channel-create-handler.js'
import { RelayV2RuntimeAdmin } from './relay-v2-runtime-admin.js'
import {
  logRelayV2MobileBound,
  logRelayV2MobileJoinPcOffline,
  logRelayV2MobileReconnecting,
  logRelayV2MobileResumePcOffline,
  logRelayV2MobileResumed,
  logRelayV2PcOffline,
  logRelayV2PcOnline
} from './relay-v2-runtime-log.js'
import {
  closeWithCode,
  parsePcControlFrame,
  parseRelayV2Text,
  RelayV2SocketRegistry,
  sendRelayV2,
  type RelayV2SocketState
} from './relay-v2-socket.js'
import {
  DEFAULT_CHANNEL_INVITE_TTL_MS,
  DEFAULT_MOBILE_RECONNECT_GRACE_MS,
  DEFAULT_RESUME_TOKEN_TTL_MS,
  UNAVAILABLE_CERT_VALUE,
  type RelayV2InitialConnectionMeta,
  type RelayV2RuntimeOptions
} from './relay-v2-runtime-options.js'
import type { RelayV2Store } from './relay-v2-store.js'

export type { RelayV2SocketState } from './relay-v2-socket.js'

export class RelayV2Runtime {
  private readonly store: RelayV2Store
  private readonly publicUrl: string
  private readonly channelInviteTtlMs: number
  private readonly resumeTokenTtlMs: number
  private readonly serverCaSha256: string
  private readonly serverCaDerB64: string
  private readonly sockets = new RelayV2SocketRegistry()
  private readonly presence: RelayV2MobilePresence
  readonly adminRuntime: RelayV2RuntimeAdmin

  constructor(options: RelayV2RuntimeOptions) {
    this.store = options.store
    this.publicUrl = options.publicUrl
    this.channelInviteTtlMs = options.channelInviteTtlMs ?? DEFAULT_CHANNEL_INVITE_TTL_MS
    this.resumeTokenTtlMs = options.resumeTokenTtlMs ?? DEFAULT_RESUME_TOKEN_TTL_MS
    this.serverCaSha256 = options.serverCaSha256 ?? UNAVAILABLE_CERT_VALUE
    this.serverCaDerB64 = options.serverCaDerB64 ?? UNAVAILABLE_CERT_VALUE
    this.presence = new RelayV2MobilePresence({
      store: this.store,
      reconnectGraceMs: options.mobileReconnectGraceMs ?? DEFAULT_MOBILE_RECONNECT_GRACE_MS,
      notifyPc: (pcId, binding) => this.notifyPcMobileState(pcId, binding)
    })
    this.adminRuntime = new RelayV2RuntimeAdmin({ store: this.store, sockets: this.sockets })
  }

  acceptInitialMessage(
    ws: WebSocket,
    message: RelayV2ClientMessage,
    meta: RelayV2InitialConnectionMeta = {}
  ): RelayV2SocketState | null {
    switch (message.type) {
      case 'pc-hello':
        return this.handlePcHello(ws, message, meta)
      case 'mobile-join':
        return this.handleMobileJoin(ws, message, meta)
      case 'mobile-resume':
        return this.handleMobileResume(ws, message, meta)
      case 'channel-create':
        closeWithCode(ws, RelayCloseCode.BadJoin, 'channel-create requires pc-hello')
        return null
    }
  }

  handleMessage(ws: WebSocket, state: RelayV2SocketState, data: RawData, isBinary: boolean): void {
    if (state.role === 'pc' && !isBinary) {
      const control = parsePcControlFrame(parseRelayV2Text(data))
      if (control) {
        handleRelayV2ChannelCreate({
          ws,
          pcId: state.pcId,
          message: control,
          store: this.store,
          sockets: this.sockets,
          presence: this.presence,
          publicUrl: this.publicUrl,
          channelInviteTtlMs: this.channelInviteTtlMs,
          serverCaSha256: this.serverCaSha256,
          serverCaDerB64: this.serverCaDerB64,
          revokeMobilesForPc: (pcId) => this.revokeMobilesForPc(pcId),
          setChannelId: (channelId) => {
            state.channelId = channelId
          }
        })
        return
      }
    }
    this.sockets.forward(ws, state, data, isBinary)
  }

  release(state: RelayV2SocketState, ws: WebSocket): void {
    if (state.role === 'pc') {
      this.releasePc(state, ws)
      return
    }
    this.releaseMobile(state, ws)
  }

  stop(): void {
    this.presence.stop()
    this.sockets.clear()
  }

  private handlePcHello(
    ws: WebSocket,
    message: PcHelloMessage,
    meta: RelayV2InitialConnectionMeta
  ): RelayV2SocketState | null {
    const existing = this.store.getPc(message.pcId)
    if (existing && !this.store.verifyPcSecret(message.pcId, message.pcSecret)) {
      closeWithCode(ws, RelayCloseCode.Unauthorized, 'unauthorized')
      return null
    }
    const pc = this.store.upsertPc({
      pcId: message.pcId,
      pcName: message.pcName,
      pcSecret: message.pcSecret,
      publicKeyB64: message.publicKeyB64,
      relayUrl: this.publicUrl
    })
    const state: Extract<RelayV2SocketState, { role: 'pc' }> = {
      kind: 'v2',
      role: 'pc',
      pcId: pc.pcId,
      channelId: pc.activeChannelId,
      connectedAt: Date.now(),
      ...(meta.remoteAddress ? { remoteAddress: meta.remoteAddress } : {})
    }
    this.sockets.bindPc(ws, state)
    logRelayV2PcOnline(pc.pcId, state.remoteAddress)
    sendRelayV2(ws, {
      type: 'pc-hello-ack',
      pcId: pc.pcId,
      state: 'online',
      mobile: this.presence.currentForPc(pc.pcId)
    })
    return state
  }

  private handleMobileJoin(
    ws: WebSocket,
    message: MobileJoinMessage,
    meta: RelayV2InitialConnectionMeta
  ): RelayV2SocketState | null {
    if (!this.store.verifyInviteToken(message.channelId, message.inviteToken)) {
      closeWithCode(ws, RelayCloseCode.Unauthorized, 'invalid invite')
      return null
    }
    const channel = this.store.getChannel(message.channelId)
    const pcSlot = channel ? this.sockets.pc(channel.pcId) : null
    if (!channel || !pcSlot) {
      logRelayV2MobileJoinPcOffline(message.channelId)
      closeWithCode(ws, RelayCloseCode.Unauthorized, 'pc offline')
      return null
    }
    const bound = this.store.bindMobileToChannel({
      channelId: message.channelId,
      mobileDeviceId: message.mobileDeviceId,
      mobileName: message.mobileName,
      resumeTokenTtlMs: this.resumeTokenTtlMs
    })
    if (!bound) {
      closeWithCode(ws, RelayCloseCode.Unauthorized, 'channel unavailable')
      return null
    }
    const state = this.bindMobileSocket(ws, {
      kind: 'v2',
      role: 'mobile',
      pcId: channel.pcId,
      mobileDeviceId: message.mobileDeviceId,
      channelId: message.channelId,
      connectedAt: Date.now(),
      ...(meta.remoteAddress ? { remoteAddress: meta.remoteAddress } : {})
    })
    this.sockets.attachPcToChannel(message.channelId, pcSlot)
    logRelayV2MobileBound({
      pcId: channel.pcId,
      mobileDeviceId: message.mobileDeviceId,
      channelId: message.channelId
    })
    sendRelayV2(ws, {
      type: 'mobile-bind-ack',
      pcId: channel.pcId,
      mobileDeviceId: message.mobileDeviceId,
      resumeToken: bound.resumeToken,
      resumeTokenExpiresAt: bound.binding.resumeTokenExpiresAt
    })
    this.notifyPcMobileState(channel.pcId, bound.binding)
    return state
  }

  private handleMobileResume(
    ws: WebSocket,
    message: MobileResumeMessage,
    meta: RelayV2InitialConnectionMeta
  ): RelayV2SocketState | null {
    if (!this.store.verifyResumeToken(message.pcId, message.mobileDeviceId, message.resumeToken)) {
      closeWithCode(ws, RelayCloseCode.Unauthorized, 'invalid resume')
      return null
    }
    const pcSlot = this.sockets.pc(message.pcId)
    const channel = this.store.findActiveChannelForMobile(message.pcId, message.mobileDeviceId)
    if (!pcSlot || !channel) {
      logRelayV2MobileResumePcOffline(message.pcId, message.mobileDeviceId)
      closeWithCode(ws, RelayCloseCode.PeerRecycled, 'pc offline')
      return null
    }
    const binding = this.presence.markConnected(message.mobileDeviceId)
    if (!binding) {
      closeWithCode(ws, RelayCloseCode.Unauthorized, 'binding unavailable')
      return null
    }
    const state = this.bindMobileSocket(ws, {
      kind: 'v2',
      role: 'mobile',
      pcId: message.pcId,
      mobileDeviceId: message.mobileDeviceId,
      channelId: channel.channelId,
      connectedAt: Date.now(),
      ...(meta.remoteAddress ? { remoteAddress: meta.remoteAddress } : {})
    })
    this.sockets.attachPcToChannel(channel.channelId, pcSlot)
    logRelayV2MobileResumed({
      pcId: message.pcId,
      mobileDeviceId: message.mobileDeviceId,
      channelId: channel.channelId
    })
    sendRelayV2(ws, {
      type: 'mobile-resume-ack',
      pcId: message.pcId,
      mobileDeviceId: message.mobileDeviceId
    })
    return state
  }

  private bindMobileSocket(
    ws: WebSocket,
    state: Extract<RelayV2SocketState, { role: 'mobile' }>
  ): Extract<RelayV2SocketState, { role: 'mobile' }> {
    this.sockets.bindMobile(ws, state)
    return state
  }

  private releasePc(state: Extract<RelayV2SocketState, { role: 'pc' }>, ws: WebSocket): void {
    const released = this.sockets.releasePc(state, ws)
    if (!released.released) {
      return
    }
    logRelayV2PcOffline(state.pcId, released.orphanedMobiles.length)
    this.store.markPcOffline(state.pcId)
    for (const mobile of released.orphanedMobiles) {
      this.presence.markReconnecting(mobile.state.mobileDeviceId)
      closeWithCode(mobile.ws, RelayCloseCode.PeerRecycled, 'pc offline')
    }
  }

  private releaseMobile(
    state: Extract<RelayV2SocketState, { role: 'mobile' }>,
    ws: WebSocket
  ): void {
    if (this.sockets.releaseMobile(state, ws)) {
      logRelayV2MobileReconnecting(state.pcId, state.mobileDeviceId)
      this.presence.markReconnecting(state.mobileDeviceId)
    }
  }

  private revokeMobilesForPc(pcId: string): void {
    for (const binding of this.presence.revokeForPc(pcId)) {
      this.adminRuntime.closeRevokedMobile(binding.mobileDeviceId)
    }
  }

  private notifyPcMobileState(pcId: string, binding: MobileBinding): void {
    const pc = this.sockets.pc(pcId)
    if (!pc) {
      return
    }
    sendRelayV2(pc.ws, {
      type: 'mobile-state',
      state: binding.state,
      mobileDeviceId: binding.mobileDeviceId,
      mobileName: binding.mobileName,
      lastSeenAt: binding.lastSeenAt
    })
  }
}
