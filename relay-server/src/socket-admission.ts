import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'

// Why: behind a TLS-terminating proxy every socket's remoteAddress is the proxy,
// so honour the first X-Forwarded-For hop when trustProxy is set; otherwise use
// the peer address. Untrusted XFF is ignored to prevent header-spoofed limits.
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
    const ip = first?.split(',')[0]?.trim()
    if (ip) {
      return ip
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}

// Why: refuse a socket that failed the admission gate (rate limit / capacity).
// It is never tracked or heartbeat-monitored, so swallow late errors to avoid an
// unhandled 'error' while the just-refused connection tears down.
export function rejectSocket(ws: WebSocket, code: number, reason: string): void {
  ws.on('error', () => {})
  try {
    ws.close(code, reason)
  } catch {
    // Why: close() can throw on a socket already tearing down; nothing to do.
  }
}
