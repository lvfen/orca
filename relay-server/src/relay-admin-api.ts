import type { IncomingMessage, ServerResponse } from 'node:http'
import { tokensEqual } from './token.js'
import type { RelayV2AdminConnectionsSnapshot } from './v2/relay-v2-admin-store.js'

export type RelayAdminRuntime = {
  snapshotConnections(): RelayV2AdminConnectionsSnapshot
  disconnectPc(pcId: string): boolean
  revokeChannel(channelId: string): boolean
  revokeMobile(mobileDeviceId: string): boolean
}

export type RelayAdminApiOptions = {
  adminToken?: string
  runtime: RelayAdminRuntime | null
}

export function handleRelayAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: RelayAdminApiOptions
): boolean {
  const url = parseRequestUrl(req.url)
  if (!url || !url.pathname.startsWith('/admin/')) {
    return false
  }
  if (!options.adminToken) {
    writeText(res, 404, 'Not Found')
    return true
  }
  if (!isAuthorized(req, options.adminToken)) {
    writeText(res, 403, 'Forbidden')
    return true
  }
  if (!options.runtime) {
    writeJson(res, 503, { error: 'relay v2 runtime unavailable' })
    return true
  }
  return handleAuthorizedAdminRequest(req, res, url, options.runtime)
}

function handleAuthorizedAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  runtime: RelayAdminRuntime
): boolean {
  if (req.method === 'GET' && url.pathname === '/admin/connections') {
    writeJson(res, 200, runtime.snapshotConnections())
    return true
  }
  if (req.method === 'POST') {
    return handleAdminMutation(res, url.pathname, runtime)
  }
  writeText(res, 405, 'Method Not Allowed')
  return true
}

function handleAdminMutation(
  res: ServerResponse,
  pathname: string,
  runtime: RelayAdminRuntime
): boolean {
  const pcId = pathParam(pathname, /^\/admin\/pcs\/([^/]+)\/disconnect$/)
  if (pcId) {
    return writeActionResult(res, runtime.disconnectPc(pcId))
  }
  const channelId = pathParam(pathname, /^\/admin\/channels\/([^/]+)\/revoke$/)
  if (channelId) {
    return writeActionResult(res, runtime.revokeChannel(channelId))
  }
  const mobileDeviceId = pathParam(pathname, /^\/admin\/mobiles\/([^/]+)\/revoke$/)
  if (mobileDeviceId) {
    return writeActionResult(res, runtime.revokeMobile(mobileDeviceId))
  }
  writeText(res, 404, 'Not Found')
  return true
}

function isAuthorized(req: IncomingMessage, adminToken: string): boolean {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return false
  }
  return tokensEqual(header.slice('Bearer '.length), adminToken)
}

function pathParam(pathname: string, pattern: RegExp): string | null {
  const match = pattern.exec(pathname)
  const value = match?.[1]
  return value ? decodeURIComponent(value) : null
}

function parseRequestUrl(raw: string | undefined): URL | null {
  if (!raw) {
    return null
  }
  try {
    return new URL(raw, 'http://localhost')
  } catch {
    return null
  }
}

function writeActionResult(res: ServerResponse, ok: boolean): true {
  writeJson(res, ok ? 200 : 404, { ok })
  return true
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function writeText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain' })
  res.end(body)
}
