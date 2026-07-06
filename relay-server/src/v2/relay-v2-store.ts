import { readSecureJson, writeSecureJson } from '../secure-file.js'
import {
  activateChannelRecord,
  createChannelRecord,
  expireChannelRecord,
  revokeChannelRecord,
  type ChannelRecord
} from './channel-store.js'
import {
  createMobileBinding,
  refreshMobileBinding,
  setMobileBindingState,
  type MobileBinding
} from './mobile-binding-store.js'
import {
  createPcRecord,
  markPcOffline,
  refreshPcRecord,
  setPcActiveChannel,
  type PcRecord
} from './pc-store.js'
import type { MobileBindingState } from './relay-v2-protocol.js'
import {
  generateChannelId,
  generateInviteToken,
  generateResumeToken,
  hashBearerToken,
  verifyBearerToken
} from './relay-v2-token.js'
import { normalizeRelayV2StoreFile, type RelayV2StoreFile } from './relay-v2-store-file.js'

export type UpsertPcInput = {
  pcId: string
  pcName: string
  pcSecret: string
  publicKeyB64: string
  relayUrl: string
  now?: number
}

export type CreatedChannel = {
  channel: ChannelRecord
  inviteToken: string
}

export type BoundMobile = {
  binding: MobileBinding
  resumeToken: string
}

export class RelayV2Store {
  constructor(private readonly storePath: string) {}

  snapshot(): RelayV2StoreFile {
    return this.load()
  }

  listPcs(): PcRecord[] {
    return this.load().pcs
  }

  getPc(pcId: string): PcRecord | null {
    return this.load().pcs.find((pc) => pc.pcId === pcId) ?? null
  }

  upsertPc(input: UpsertPcInput): PcRecord {
    const now = input.now ?? Date.now()
    const store = this.load()
    const existing = store.pcs.find((pc) => pc.pcId === input.pcId)
    const pcInput = { ...input, pcSecretHash: hashBearerToken(input.pcSecret), now }
    const pc = existing ? refreshPcRecord(existing, pcInput) : createPcRecord(pcInput)
    this.persist({ ...store, pcs: replaceById(store.pcs, 'pcId', pc) })
    return pc
  }

  verifyPcSecret(pcId: string, pcSecret: string): boolean {
    const pc = this.getPc(pcId)
    return pc ? verifyBearerToken(pcSecret, pc.pcSecretHash) : false
  }

  markPcOffline(pcId: string, now = Date.now()): PcRecord | null {
    const store = this.load()
    const pc = store.pcs.find((record) => record.pcId === pcId)
    if (!pc) {
      return null
    }
    const next = markPcOffline(pc, now)
    this.persist({ ...store, pcs: replaceById(store.pcs, 'pcId', next) })
    return next
  }

  clearPcActiveChannelForChannel(pcId: string, channelId: string): PcRecord | null {
    const store = this.load()
    const pc = store.pcs.find((record) => record.pcId === pcId)
    if (!pc || pc.activeChannelId !== channelId) {
      return null
    }
    const next = setPcActiveChannel(pc, null)
    this.persist({ ...store, pcs: replaceById(store.pcs, 'pcId', next) })
    return next
  }

  createChannel(pcId: string, ttlMs: number, now = Date.now()): CreatedChannel | null {
    const store = this.load()
    const pc = store.pcs.find((record) => record.pcId === pcId)
    if (!pc) {
      return null
    }
    const inviteToken = generateInviteToken()
    const channel = createChannelRecord({
      channelId: generateChannelId(),
      pcId,
      inviteTokenHash: hashBearerToken(inviteToken),
      now,
      expiresAt: now + ttlMs
    })
    const nextPc = setPcActiveChannel(pc, channel.channelId)
    this.persist({
      ...store,
      pcs: replaceById(store.pcs, 'pcId', nextPc),
      channels: [...store.channels, channel]
    })
    return { channel, inviteToken }
  }

  listChannels(): ChannelRecord[] {
    return this.load().channels
  }

  getChannel(channelId: string): ChannelRecord | null {
    return this.load().channels.find((channel) => channel.channelId === channelId) ?? null
  }

  findActiveChannelForMobile(pcId: string, mobileDeviceId: string): ChannelRecord | null {
    return (
      this.load().channels.find(
        (channel) =>
          channel.pcId === pcId &&
          channel.mobileDeviceId === mobileDeviceId &&
          channel.state === 'active'
      ) ?? null
    )
  }

  verifyInviteToken(channelId: string, inviteToken: string, now = Date.now()): boolean {
    const channel = this.getChannel(channelId)
    return (
      channel !== null &&
      channel.state === 'pending' &&
      channel.expiresAt > now &&
      verifyBearerToken(inviteToken, channel.inviteTokenHash)
    )
  }

  expireStaleChannels(now = Date.now()): number {
    const store = this.load()
    let expired = 0
    const channels = store.channels.map((channel) => {
      if (channel.state === 'pending' && channel.expiresAt <= now) {
        expired += 1
        return expireChannelRecord(channel)
      }
      return channel
    })
    if (expired > 0) {
      this.persist({ ...store, channels })
    }
    return expired
  }

  revokeChannel(channelId: string): ChannelRecord | null {
    const store = this.load()
    const channel = store.channels.find((record) => record.channelId === channelId)
    if (!channel) {
      return null
    }
    const next = revokeChannelRecord(channel)
    this.persist({ ...store, channels: replaceById(store.channels, 'channelId', next) })
    return next
  }

  bindMobileToChannel(input: {
    channelId: string
    mobileDeviceId: string
    mobileName: string
    resumeTokenTtlMs: number
    now?: number
  }): BoundMobile | null {
    const now = input.now ?? Date.now()
    const store = this.load()
    const channel = store.channels.find((record) => record.channelId === input.channelId)
    if (!channel || channel.state !== 'pending' || channel.expiresAt <= now) {
      return null
    }
    const resumeToken = generateResumeToken()
    const bindingInput = {
      mobileDeviceId: input.mobileDeviceId,
      mobileName: input.mobileName,
      pcId: channel.pcId,
      resumeTokenHash: hashBearerToken(resumeToken),
      resumeTokenExpiresAt: now + input.resumeTokenTtlMs,
      now
    }
    const existing = store.mobileBindings.find(
      (binding) => binding.mobileDeviceId === input.mobileDeviceId
    )
    const binding = existing
      ? refreshMobileBinding(existing, bindingInput)
      : createMobileBinding(bindingInput)
    const nextChannel = activateChannelRecord(channel, input.mobileDeviceId)
    this.persist({
      ...store,
      channels: replaceById(store.channels, 'channelId', nextChannel),
      mobileBindings: replaceById(store.mobileBindings, 'mobileDeviceId', binding)
    })
    return { binding, resumeToken }
  }

  listMobileBindings(): MobileBinding[] {
    return this.load().mobileBindings
  }

  getMobileBinding(mobileDeviceId: string): MobileBinding | null {
    return (
      this.load().mobileBindings.find((binding) => binding.mobileDeviceId === mobileDeviceId) ??
      null
    )
  }

  verifyResumeToken(
    pcId: string,
    mobileDeviceId: string,
    resumeToken: string,
    now = Date.now()
  ): boolean {
    const binding = this.getMobileBinding(mobileDeviceId)
    return (
      binding !== null &&
      binding.pcId === pcId &&
      binding.state !== 'revoked' &&
      binding.resumeTokenExpiresAt > now &&
      verifyBearerToken(resumeToken, binding.resumeTokenHash)
    )
  }

  setMobileState(
    mobileDeviceId: string,
    state: MobileBindingState,
    now = Date.now()
  ): MobileBinding | null {
    const store = this.load()
    const binding = store.mobileBindings.find((record) => record.mobileDeviceId === mobileDeviceId)
    if (!binding) {
      return null
    }
    const next = setMobileBindingState(binding, state, now)
    this.persist({
      ...store,
      mobileBindings: replaceById(store.mobileBindings, 'mobileDeviceId', next)
    })
    return next
  }

  revokeMobileBinding(mobileDeviceId: string, now = Date.now()): MobileBinding | null {
    return this.setMobileState(mobileDeviceId, 'revoked', now)
  }

  private load(): RelayV2StoreFile {
    return normalizeRelayV2StoreFile(readSecureJson<RelayV2StoreFile>(this.storePath))
  }

  private persist(store: RelayV2StoreFile): void {
    writeSecureJson(this.storePath, store)
  }
}

function replaceById<T extends Record<K, string>, K extends keyof T>(
  records: T[],
  key: K,
  next: T
): T[] {
  const index = records.findIndex((record) => record[key] === next[key])
  if (index === -1) {
    return [...records, next]
  }
  return [...records.slice(0, index), next, ...records.slice(index + 1)]
}
