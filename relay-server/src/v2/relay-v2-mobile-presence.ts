import type { MobileBinding } from './mobile-binding-store.js'
import type { PcMobileSummary } from './relay-v2-protocol.js'
import type { RelayV2Store } from './relay-v2-store.js'

export type RelayV2MobilePresenceOptions = {
  store: RelayV2Store
  reconnectGraceMs: number
  notifyPc: (pcId: string, binding: MobileBinding) => void
}

export class RelayV2MobilePresence {
  private readonly store: RelayV2Store
  private readonly reconnectGraceMs: number
  private readonly notifyPc: (pcId: string, binding: MobileBinding) => void
  private readonly offlineTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(options: RelayV2MobilePresenceOptions) {
    this.store = options.store
    this.reconnectGraceMs = options.reconnectGraceMs
    this.notifyPc = options.notifyPc
  }

  markConnected(mobileDeviceId: string): MobileBinding | null {
    this.clearOfflineTimer(mobileDeviceId)
    const binding = this.store.setMobileState(mobileDeviceId, 'connected')
    if (binding) {
      this.notifyPc(binding.pcId, binding)
    }
    return binding
  }

  markReconnecting(mobileDeviceId: string): void {
    const binding = this.store.setMobileState(mobileDeviceId, 'reconnecting')
    if (!binding) {
      return
    }
    this.notifyPc(binding.pcId, binding)
    this.startOfflineTimer(mobileDeviceId)
  }

  revokeForPc(pcId: string): MobileBinding[] {
    const revoked: MobileBinding[] = []
    for (const binding of this.store.listMobileBindings()) {
      if (binding.pcId !== pcId || binding.state === 'revoked') {
        continue
      }
      const next = this.store.revokeMobileBinding(binding.mobileDeviceId)
      if (!next) {
        continue
      }
      this.clearOfflineTimer(next.mobileDeviceId)
      this.notifyPc(pcId, next)
      revoked.push(next)
    }
    return revoked
  }

  currentForPc(pcId: string): PcMobileSummary | null {
    return (
      this.store
        .listMobileBindings()
        .filter((binding) => binding.pcId === pcId && binding.state !== 'revoked')
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
        .map((binding) => ({
          mobileDeviceId: binding.mobileDeviceId,
          mobileName: binding.mobileName,
          state: binding.state,
          lastSeenAt: binding.lastSeenAt
        }))[0] ?? null
    )
  }

  stop(): void {
    for (const timer of this.offlineTimers.values()) {
      clearTimeout(timer)
    }
    this.offlineTimers.clear()
  }

  private startOfflineTimer(mobileDeviceId: string): void {
    this.clearOfflineTimer(mobileDeviceId)
    const timer = setTimeout(() => {
      const binding = this.store.getMobileBinding(mobileDeviceId)
      if (binding?.state !== 'reconnecting') {
        return
      }
      const next = this.store.setMobileState(mobileDeviceId, 'offline')
      if (next) {
        this.notifyPc(next.pcId, next)
      }
      this.offlineTimers.delete(mobileDeviceId)
    }, this.reconnectGraceMs)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
    this.offlineTimers.set(mobileDeviceId, timer)
  }

  private clearOfflineTimer(mobileDeviceId: string): void {
    const timer = this.offlineTimers.get(mobileDeviceId)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.offlineTimers.delete(mobileDeviceId)
  }
}
