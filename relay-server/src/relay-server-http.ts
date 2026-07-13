import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { RelayCertificateDiscovery } from './certificate-discovery.js'
import type { RelayConfig } from './config.js'
import { handleRelayAdminRequest, type RelayAdminRuntime } from './relay-admin-api.js'
import { handleCertificateDiscoveryRequest } from './relay-certificate-discovery-http.js'
import type { RelayMetricsSnapshot } from './relay-metrics.js'

export type RelayHttpServer = HttpServer | HttpsServer

export type RelayHttpRequestOptions = {
  metrics: RelayMetricsSnapshot
  adminToken?: string
  adminRuntime: RelayAdminRuntime | null
  certificateDiscovery?: RelayCertificateDiscovery
}

export function createRelayHttpServer(config: RelayConfig): RelayHttpServer {
  if (config.tlsCert && config.tlsKey) {
    return createHttpsServer({ cert: config.tlsCert, key: config.tlsKey })
  }
  return createHttpServer()
}

// Why: GET /healthz (or /metrics) exposes connection-level counters as JSON for
// uptime probes / operators. Every other plain HTTP request is a non-upgrade
// hit on the WS port, so answer 426 Upgrade Required.
export function handleRelayHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: RelayHttpRequestOptions
): void {
  if (handleCertificateDiscoveryRequest(req, res, options.certificateDiscovery)) {
    return
  }
  if (
    handleRelayAdminRequest(req, res, {
      ...(options.adminToken ? { adminToken: options.adminToken } : {}),
      runtime: options.adminRuntime
    })
  ) {
    return
  }
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/metrics')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(options.metrics))
    return
  }
  res.writeHead(426, { 'content-type': 'text/plain' })
  res.end('Upgrade Required')
}
