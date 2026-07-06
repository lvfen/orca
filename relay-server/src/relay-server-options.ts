import type { RelayConfig } from './config.js'
import type { RoomStore } from './room-store.js'
import type { RelayV2Store } from './v2/relay-v2-store.js'

export type RelayV2RuntimeTuning = {
  channelInviteTtlMs?: number
  resumeTokenTtlMs?: number
  mobileReconnectGraceMs?: number
  serverCaSha256?: string
  serverCaDerB64?: string
}

export type RelayServerOptions = {
  config: RelayConfig
  store: RoomStore
  // Why: test-only overrides. Production uses the protocol/config constants.
  heartbeatIntervalMs?: number
  preJoinTimeoutMs?: number
  maxConnectionsPerWindow?: number
  rateLimitWindowMs?: number
  maxConcurrentConnections?: number
  trustProxy?: boolean
  v2Store?: RelayV2Store
  relayV2?: RelayV2RuntimeTuning
  now?: () => number
}
