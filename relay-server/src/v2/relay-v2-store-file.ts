import type { ChannelRecord } from './channel-store.js'
import type { MobileBinding } from './mobile-binding-store.js'
import type { PcRecord } from './pc-store.js'

export type RelayV2StoreFile = {
  version: 1
  pcs: PcRecord[]
  channels: ChannelRecord[]
  mobileBindings: MobileBinding[]
}

const STORE_VERSION = 1

export function emptyRelayV2StoreFile(): RelayV2StoreFile {
  return { version: STORE_VERSION, pcs: [], channels: [], mobileBindings: [] }
}

export function normalizeRelayV2StoreFile(raw: unknown): RelayV2StoreFile {
  if (!isStoreFile(raw)) {
    return emptyRelayV2StoreFile()
  }
  return {
    version: STORE_VERSION,
    pcs: raw.pcs.filter(isPcRecord),
    channels: raw.channels.filter(isChannelRecord),
    mobileBindings: raw.mobileBindings.filter(isMobileBinding)
  }
}

function isStoreFile(value: unknown): value is RelayV2StoreFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RelayV2StoreFile).version === STORE_VERSION &&
    Array.isArray((value as RelayV2StoreFile).pcs) &&
    Array.isArray((value as RelayV2StoreFile).channels) &&
    Array.isArray((value as RelayV2StoreFile).mobileBindings)
  )
}

function isPcRecord(value: unknown): value is PcRecord {
  const record = value as PcRecord
  return (
    isObject(value) &&
    typeof record.pcId === 'string' &&
    typeof record.pcName === 'string' &&
    typeof record.pcSecretHash === 'string' &&
    typeof record.publicKeyB64 === 'string' &&
    typeof record.relayUrl === 'string' &&
    (record.state === 'online' || record.state === 'offline') &&
    (record.activeChannelId === null || typeof record.activeChannelId === 'string') &&
    typeof record.createdAt === 'number' &&
    typeof record.lastSeenAt === 'number'
  )
}

function isChannelRecord(value: unknown): value is ChannelRecord {
  const record = value as ChannelRecord
  return (
    isObject(value) &&
    typeof record.channelId === 'string' &&
    typeof record.pcId === 'string' &&
    typeof record.inviteTokenHash === 'string' &&
    ['pending', 'active', 'expired', 'revoked'].includes(record.state) &&
    (record.mobileDeviceId === null || typeof record.mobileDeviceId === 'string') &&
    typeof record.createdAt === 'number' &&
    typeof record.expiresAt === 'number'
  )
}

function isMobileBinding(value: unknown): value is MobileBinding {
  const record = value as MobileBinding
  return (
    isObject(value) &&
    typeof record.mobileDeviceId === 'string' &&
    typeof record.mobileName === 'string' &&
    typeof record.pcId === 'string' &&
    typeof record.resumeTokenHash === 'string' &&
    typeof record.resumeTokenExpiresAt === 'number' &&
    ['connected', 'reconnecting', 'offline', 'revoked'].includes(record.state) &&
    (record.connectedAt === null || typeof record.connectedAt === 'number') &&
    (record.disconnectedAt === null || typeof record.disconnectedAt === 'number') &&
    typeof record.lastSeenAt === 'number'
  )
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
