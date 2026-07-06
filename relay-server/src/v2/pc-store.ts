import type { PcConnectionState } from './relay-v2-protocol.js'

export type PcRecord = {
  pcId: string
  pcName: string
  pcSecretHash: string
  publicKeyB64: string
  relayUrl: string
  state: PcConnectionState
  activeChannelId: string | null
  createdAt: number
  lastSeenAt: number
}

export type PcRecordInput = {
  pcId: string
  pcName: string
  pcSecretHash: string
  publicKeyB64: string
  relayUrl: string
  now: number
}

export function createPcRecord(input: PcRecordInput): PcRecord {
  return {
    pcId: input.pcId,
    pcName: input.pcName,
    pcSecretHash: input.pcSecretHash,
    publicKeyB64: input.publicKeyB64,
    relayUrl: input.relayUrl,
    state: 'online',
    activeChannelId: null,
    createdAt: input.now,
    lastSeenAt: input.now
  }
}

export function refreshPcRecord(record: PcRecord, input: PcRecordInput): PcRecord {
  return {
    ...record,
    pcName: input.pcName,
    publicKeyB64: input.publicKeyB64,
    relayUrl: input.relayUrl,
    state: 'online',
    lastSeenAt: input.now
  }
}

export function markPcOffline(record: PcRecord, now: number): PcRecord {
  return { ...record, state: 'offline', lastSeenAt: now }
}

export function setPcActiveChannel(record: PcRecord, channelId: string | null): PcRecord {
  return { ...record, activeChannelId: channelId }
}
