import { z } from 'zod'

export type RpcRequest = {
  id: string
  deviceToken: string
  method: string
  params?: unknown
}

export type RpcSuccess = {
  id: string
  ok: true
  result: unknown
  streaming?: true
  _meta: { runtimeId: string }
}

export type RpcFailure = {
  id: string
  ok: false
  error: { code: string; message: string; data?: unknown }
  _meta: { runtimeId: string }
}

export type RpcResponse = RpcSuccess | RpcFailure

const PAIRING_OFFER_VERSION = 2

export const PairingOfferSchema = z.object({
  v: z.literal(PAIRING_OFFER_VERSION),
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1)
})

export type PairingOffer = z.infer<typeof PairingOfferSchema>

export type ConnectionLogLevel = 'info' | 'success' | 'warn' | 'error'

export type ConnectionLogEntry = {
  id: string
  ts: number
  level: ConnectionLogLevel
  // Short human-readable phase label, e.g. 'Opening WebSocket'.
  message: string
  // Optional second line for endpoint/error/elapsed detail.
  detail?: string
}

export type ConnectionLogSink = (entry: ConnectionLogEntry) => void

export type ConnectionState =
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'auth-failed'
  // Why: relay close code 4409 — the host slot was taken over by the same
  // token on another device. Terminal (no auto-reconnect); the user must
  // re-pair on the PC to reclaim the slot.
  | 'occupied'

// Why: 'lan' hosts dial a LAN/Tailnet WebSocket directly; relay hosts dial an
// outbound relay and run a pre-handshake before the shared E2EE flow. v1 uses
// client-join + mobileToken; v2 uses mobile-resume + resumeToken.
export type HostKind = 'lan' | 'relay' | 'relay-v2'

export type HostProfile = {
  id: string
  name: string
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  lastConnected: number
  kind: HostKind
  pcId?: string
  mobileDeviceId?: string
  mobileToken?: string
  roomId?: string
  resumeTokenExpiresAt?: number
  serverCaSha256?: string
}

export const HostProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    endpoint: z.string().min(1),
    deviceToken: z.string().min(1),
    publicKeyB64: z.string().min(1),
    lastConnected: z.number().finite(),
    // Why: records written before relay support lack `kind`; default to 'lan'
    // so existing LAN hosts keep working without a migration pass.
    kind: z.enum(['lan', 'relay', 'relay-v2']).default('lan'),
    pcId: z.string().min(1).optional(),
    mobileDeviceId: z.string().min(1).optional(),
    mobileToken: z.string().min(1).optional(),
    roomId: z.string().min(1).optional(),
    resumeTokenExpiresAt: z.number().finite().optional(),
    serverCaSha256: z.string().min(1).optional()
  })
  .refine((host) => host.kind !== 'relay' || (!!host.mobileToken && !!host.roomId), {
    message: 'relay hosts require mobileToken and roomId'
  })
  .refine(
    (host) =>
      host.kind !== 'relay-v2' || (!!host.mobileToken && !!host.pcId && !!host.mobileDeviceId),
    {
      message: 'relay-v2 hosts require resume token, pcId, and mobileDeviceId'
    }
  )

// Why: persisted host record after the v0.0.3 keychain split. The deviceToken
// (and, for relay hosts, the mobileToken) are held in the iOS Keychain via
// expo-secure-store and joined in at load time; they must NOT appear in
// AsyncStorage.
export const StoredHostProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  publicKeyB64: z.string().min(1),
  lastConnected: z.number().finite(),
  kind: z.enum(['lan', 'relay', 'relay-v2']).default('lan'),
  pcId: z.string().min(1).optional(),
  mobileDeviceId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  resumeTokenExpiresAt: z.number().finite().optional(),
  serverCaSha256: z.string().min(1).optional()
})

export type StoredHostProfile = z.infer<typeof StoredHostProfileSchema>
