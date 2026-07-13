import type { ChannelState } from './relay-v2-protocol.js'

export type ChannelRecord = {
  channelId: string
  pcId: string
  inviteTokenHash: string
  state: ChannelState
  mobileDeviceId: string | null
  createdAt: number
  expiresAt: number
}

export type ChannelRecordInput = {
  channelId: string
  pcId: string
  inviteTokenHash: string
  now: number
  expiresAt: number
}

export function createChannelRecord(input: ChannelRecordInput): ChannelRecord {
  return {
    channelId: input.channelId,
    pcId: input.pcId,
    inviteTokenHash: input.inviteTokenHash,
    state: 'pending',
    mobileDeviceId: null,
    createdAt: input.now,
    expiresAt: input.expiresAt
  }
}

export function activateChannelRecord(
  record: ChannelRecord,
  mobileDeviceId: string
): ChannelRecord {
  return { ...record, state: 'active', mobileDeviceId }
}

export function expireChannelRecord(record: ChannelRecord): ChannelRecord {
  return record.state === 'pending' ? { ...record, state: 'expired' } : record
}

export function revokeChannelRecord(record: ChannelRecord): ChannelRecord {
  return { ...record, state: 'revoked' }
}
