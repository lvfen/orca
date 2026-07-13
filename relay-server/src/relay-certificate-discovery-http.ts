import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RelayCertificateDiscovery } from './certificate-discovery.js'

const CA_CER_PATH = '/.well-known/orca-relay/ca.cer'
const CA_MOBILECONFIG_PATH = '/.well-known/orca-relay/ca.mobileconfig'
const CERT_TOKEN_PATH = '/.well-known/orca-relay/cert-token'

export function handleCertificateDiscoveryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  discovery: RelayCertificateDiscovery | undefined
): boolean {
  if (req.method !== 'GET' || !isCertificateDiscoveryPath(req.url)) {
    return false
  }
  if (!discovery) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Not Found')
    return true
  }
  switch (req.url) {
    case CA_CER_PATH:
      res.writeHead(200, { 'content-type': 'application/pkix-cert' })
      res.end(discovery.caCertDer)
      return true
    case CA_MOBILECONFIG_PATH:
      res.writeHead(200, { 'content-type': 'application/x-apple-aspen-config' })
      res.end(discovery.caMobileConfig)
      return true
    case CERT_TOKEN_PATH:
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`${discovery.certificateToken}\n`)
      return true
    default:
      return false
  }
}

function isCertificateDiscoveryPath(url: string | undefined): boolean {
  return url === CA_CER_PATH || url === CA_MOBILECONFIG_PATH || url === CERT_TOKEN_PATH
}
