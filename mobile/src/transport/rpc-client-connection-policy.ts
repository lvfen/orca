// Why: tiered backoff. The first four entries (500ms->4s) keep
// auto-recovery snappy for the common case: a brief Wi-Fi blip,
// laptop wake, or AP-isolation cycle. Beyond that we slow down
// so an unreachable desktop does not burn a TCP SYN every 4s forever.
export const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000, 15_000, 30_000, 60_000]

// Why: cap auto-retry once we're clearly unreachable. With the tiered backoff
// above this is about 6 minutes. MUST stay aligned with connection-health.ts
// UNREACHABLE_ATTEMPTS so the UI verdict matches the paused reconnect loop.
export const GIVE_UP_AFTER_ATTEMPTS = 12

// Why: a single `unauthorized`/`e2ee_error` can be a transient resume race.
// Retry the full handshake before declaring the pairing dead.
export const AUTH_RETRY_BUDGET = 3

export const REQUEST_TIMEOUT_MS = 30_000
export const CONNECT_TIMEOUT_MS = 12_000
export const HANDSHAKE_TIMEOUT_MS = 5_000

// Why: relay hosts may still be connecting. If room-ready never arrives,
// close so the normal reconnect path heals once the host is online.
export const RELAY_JOIN_TIMEOUT_MS = 12_000

// Why: RN's WebSocket implementation may not expose static readyState
// constants, but the protocol value for CONNECTING is stable.
export const WEBSOCKET_CONNECTING_STATE = 0

// Why: RN auto-pongs WebSocket pings natively, so JS needs an app-level
// liveness probe to detect half-open sockets.
export const ACTIVITY_PROBE_INTERVAL_MS = 20_000
