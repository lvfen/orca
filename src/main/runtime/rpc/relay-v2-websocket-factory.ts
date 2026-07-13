import { WebSocket } from 'ws'

export function openRelayV2WebSocket(relayUrl: string, serverCaDerB64: string | null): WebSocket {
  return new WebSocket(
    relayUrl,
    serverCaDerB64 ? { ca: certificateDerBase64ToPem(serverCaDerB64) } : undefined
  )
}

function certificateDerBase64ToPem(certificateDerB64: string): string {
  const body = certificateDerB64.match(/.{1,64}/g)?.join('\n') ?? certificateDerB64
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`
}
