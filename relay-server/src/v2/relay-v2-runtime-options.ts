import type { RelayV2Store } from './relay-v2-store.js'

export type RelayV2RuntimeOptions = {
  store: RelayV2Store
  publicUrl: string
  channelInviteTtlMs?: number
  resumeTokenTtlMs?: number
  mobileReconnectGraceMs?: number
  serverCaSha256?: string
  serverCaDerB64?: string
}

export type RelayV2InitialConnectionMeta = {
  remoteAddress?: string
}

export const DEFAULT_CHANNEL_INVITE_TTL_MS = 5 * 60_000
export const DEFAULT_RESUME_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000
export const DEFAULT_MOBILE_RECONNECT_GRACE_MS = 30_000
export const UNAVAILABLE_CERT_VALUE = 'unavailable'
