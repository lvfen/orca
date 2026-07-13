// Why: the transport interface decouples the RPC server from a specific
// transport mechanism (Unix socket, WebSocket, named pipe). Each transport
// owns its own connection lifecycle — the RPC server just binds message
// handling to whatever transports are registered. Individual transports
// override `onMessage` with their own richer signatures (e.g. Unix adds a
// `RpcMessageContext` with an abort signal; WebSocket adds the `ws` handle
// for auth association). Consumers hold a concrete transport type, not
// `RpcTransport`, when they need those extensions.

// Why: per-message hook bag owned by the Unix transport. `signal` aborts
// when the underlying connection terminates so long-poll handlers can bail
// out. `startKeepalive` is opt-in per request — only long-poll dispatches
// call it, so short RPCs pay no timer overhead. See design doc §3.1.
export type RpcMessageContext = {
  signal: AbortSignal
  startKeepalive: () => void
}

export type RpcTransport = {
  start(): Promise<void>
  stop(): Promise<void>
}

// Why: the mobile E2EE/dispatch wiring in runtime-rpc.ts is identical whether a
// phone reaches the runtime over a direct LAN WebSocket or through the relay
// bridge — one socket ⇒ one connection ⇒ one E2EEChannel. Both the
// WebSocketTransport and the RelayTransport satisfy this shape so that wiring
// can be reused verbatim (see OrcaRuntimeRpcServer.wireMobileTransport).
import type { WebSocket } from 'ws'

export type MobileTransportMessage = string | Uint8Array<ArrayBufferLike>

export type MobileTransport = {
  onMessage(
    handler: (msg: MobileTransportMessage, reply: (response: string) => void, ws: WebSocket) => void
  ): void
  onConnectionClose(
    handler: (clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void
  ): void
  setClientId(ws: WebSocket, clientId: string): void
}
