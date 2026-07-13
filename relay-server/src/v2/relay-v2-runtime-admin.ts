import { RelayCloseCode } from '../protocol.js'
import type { MobileBinding } from './mobile-binding-store.js'
import {
  revokeRelayV2ChannelInStore,
  revokeRelayV2MobileInStore,
  snapshotRelayV2Connections,
  type RelayV2AdminConnectionsSnapshot
} from './relay-v2-admin-store.js'
import { closeWithCode, sendRelayV2, type RelayV2SocketRegistry } from './relay-v2-socket.js'
import type { RelayV2Store } from './relay-v2-store.js'

export type RelayV2RuntimeAdminOptions = {
  store: RelayV2Store
  sockets: RelayV2SocketRegistry
}

export class RelayV2RuntimeAdmin {
  private readonly store: RelayV2Store
  private readonly sockets: RelayV2SocketRegistry

  constructor(options: RelayV2RuntimeAdminOptions) {
    this.store = options.store
    this.sockets = options.sockets
  }

  snapshotConnections(): RelayV2AdminConnectionsSnapshot {
    return snapshotRelayV2Connections(this.store, this.sockets.livePcs())
  }

  disconnectPc(pcId: string): boolean {
    const slot = this.sockets.pc(pcId)
    const changed = this.store.markPcOffline(pcId) !== null
    if (slot) {
      closeWithCode(slot.ws, RelayCloseCode.PeerRecycled, 'admin disconnect')
      return true
    }
    return changed
  }

  revokeChannel(channelId: string): boolean {
    const channel = this.store.getChannel(channelId)
    if (!channel || !revokeRelayV2ChannelInStore(this.store, channelId)) {
      return false
    }
    if (channel.mobileDeviceId) {
      const binding = this.store.getMobileBinding(channel.mobileDeviceId)
      this.closeRevokedMobile(channel.mobileDeviceId)
      if (binding) {
        this.notifyPcMobileState(binding.pcId, binding)
      }
    }
    return true
  }

  revokeMobile(mobileDeviceId: string): boolean {
    const binding = this.store.getMobileBinding(mobileDeviceId)
    if (!binding || !revokeRelayV2MobileInStore(this.store, mobileDeviceId)) {
      return false
    }
    this.closeRevokedMobile(mobileDeviceId)
    this.notifyRevokedMobile(binding)
    return true
  }

  closeRevokedMobile(mobileDeviceId: string): void {
    const mobile = this.sockets.removeMobile(mobileDeviceId)
    if (mobile) {
      closeWithCode(mobile.ws, RelayCloseCode.Unauthorized, 'revoked')
    }
  }

  private notifyRevokedMobile(binding: MobileBinding): void {
    const now = Date.now()
    this.notifyPcMobileState(binding.pcId, {
      ...binding,
      state: 'revoked',
      disconnectedAt: now,
      lastSeenAt: now
    })
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
