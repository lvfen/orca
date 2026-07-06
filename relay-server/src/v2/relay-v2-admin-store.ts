import type { ChannelState, MobileBindingState, PcConnectionState } from './relay-v2-protocol.js'
import type { RelayV2Store } from './relay-v2-store.js'

export type RelayV2LivePc = {
  pcId: string
  remoteAddress?: string
}

export type RelayV2AdminPc = {
  pcId: string
  pcName: string
  state: PcConnectionState
  activeChannelId: string | null
  lastSeenAt: number
  remoteAddress?: string
  mobileDeviceId?: string
  mobileName?: string
  mobileState?: MobileBindingState
  mobileLastSeenAt?: number
}

export type RelayV2AdminChannel = {
  channelId: string
  pcId: string
  state: ChannelState
  mobileDeviceId: string | null
  createdAt: number
  expiresAt: number
}

export type RelayV2AdminMobile = {
  mobileDeviceId: string
  mobileName: string
  pcId: string
  state: MobileBindingState
  connectedAt: number | null
  disconnectedAt: number | null
  lastSeenAt: number
  resumeTokenExpiresAt: number
}

export type RelayV2AdminConnectionsSnapshot = {
  pcs: RelayV2AdminPc[]
  channels: RelayV2AdminChannel[]
  mobiles: RelayV2AdminMobile[]
}

export function snapshotRelayV2Connections(
  store: RelayV2Store,
  livePcs: RelayV2LivePc[] = []
): RelayV2AdminConnectionsSnapshot {
  const livePcMap = new Map(livePcs.map((pc) => [pc.pcId, pc]))
  const bindings = store.listMobileBindings()
  const pcs = store.listPcs().map((pc) => {
    const livePc = livePcMap.get(pc.pcId)
    const mobile = latestMobileForPc(pc.pcId, bindings)
    const summary: RelayV2AdminPc = {
      pcId: pc.pcId,
      pcName: pc.pcName,
      state: livePc ? 'online' : pc.state,
      activeChannelId: pc.activeChannelId,
      lastSeenAt: pc.lastSeenAt
    }
    if (livePc?.remoteAddress) {
      summary.remoteAddress = livePc.remoteAddress
    }
    if (mobile) {
      summary.mobileDeviceId = mobile.mobileDeviceId
      summary.mobileName = mobile.mobileName
      summary.mobileState = mobile.state
      summary.mobileLastSeenAt = mobile.lastSeenAt
    }
    return summary
  })

  return {
    pcs,
    channels: store.listChannels().map((channel) => ({
      channelId: channel.channelId,
      pcId: channel.pcId,
      state: channel.state,
      mobileDeviceId: channel.mobileDeviceId,
      createdAt: channel.createdAt,
      expiresAt: channel.expiresAt
    })),
    mobiles: bindings.map((binding) => ({
      mobileDeviceId: binding.mobileDeviceId,
      mobileName: binding.mobileName,
      pcId: binding.pcId,
      state: binding.state,
      connectedAt: binding.connectedAt,
      disconnectedAt: binding.disconnectedAt,
      lastSeenAt: binding.lastSeenAt,
      resumeTokenExpiresAt: binding.resumeTokenExpiresAt
    }))
  }
}

export function disconnectRelayV2PcInStore(store: RelayV2Store, pcId: string): boolean {
  return store.markPcOffline(pcId) !== null
}

export function revokeRelayV2ChannelInStore(store: RelayV2Store, channelId: string): boolean {
  const channel = store.getChannel(channelId)
  if (!channel) {
    return false
  }
  store.revokeChannel(channelId)
  store.clearPcActiveChannelForChannel(channel.pcId, channelId)
  if (channel.mobileDeviceId) {
    store.revokeMobileBinding(channel.mobileDeviceId)
  }
  return true
}

export function revokeRelayV2MobileInStore(store: RelayV2Store, mobileDeviceId: string): boolean {
  const binding = store.revokeMobileBinding(mobileDeviceId)
  if (!binding) {
    return false
  }
  for (const channel of store.listChannels()) {
    if (channel.mobileDeviceId !== mobileDeviceId || channel.state === 'revoked') {
      continue
    }
    store.revokeChannel(channel.channelId)
    store.clearPcActiveChannelForChannel(channel.pcId, channel.channelId)
  }
  return true
}

function latestMobileForPc(
  pcId: string,
  bindings: ReturnType<RelayV2Store['listMobileBindings']>
): ReturnType<RelayV2Store['listMobileBindings']>[number] | null {
  return (
    bindings
      .filter((binding) => binding.pcId === pcId && binding.state !== 'revoked')
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0] ?? null
  )
}
