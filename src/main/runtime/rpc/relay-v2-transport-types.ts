import type { WebSocket } from 'ws'
import type { MobileTransportMessage } from './transport'

export type RelayV2MessageHandler = (
  msg: MobileTransportMessage,
  reply: (response: string) => void,
  ws: WebSocket
) => void

export type RelayV2CloseHandler = (
  clientId: string | null,
  ws: WebSocket,
  hasOtherConnections: boolean
) => void

export type RelayV2TransportOptions = {
  relayUrl: string
  pcId: string
  pcName: string
  pcSecret: string
  accessToken: string
  publicKeyB64: string
  serverCaDerB64?: string
  reconnectDelaysMs?: number[]
  connectTimeoutMs?: number
  keepaliveIntervalMs?: number
  inviteTimeoutMs?: number
}
