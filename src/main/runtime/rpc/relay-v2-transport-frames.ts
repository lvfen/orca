import type { MobileStateMessage, PcMobileSummary } from '../../../shared/relay-v2-protocol'
import type { WebSocket } from 'ws'

const CERTIFICATE_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_SIGNATURE_FAILURE',
  'CERT_HAS_EXPIRED'
])

export const noopRelayV2Reply = (): void => {}

export function mobileStateToSummary(
  message: MobileStateMessage,
  previous: PcMobileSummary | null
): PcMobileSummary | null {
  if (!message.mobileDeviceId || !message.mobileName) {
    if (!previous) {
      return null
    }
    return { ...previous, state: message.state, lastSeenAt: message.lastSeenAt }
  }
  return {
    mobileDeviceId: message.mobileDeviceId,
    mobileName: message.mobileName,
    state: message.state,
    lastSeenAt: message.lastSeenAt
  }
}

export function isRelayV2CertificateError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && CERTIFICATE_ERROR_CODES.has(code)
}

export function rawRelayV2DataToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') {
    return data
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf-8')
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf-8')
  }
  return data.toString('utf-8')
}

export function rawRelayV2DataToBytes(data: WebSocket.RawData): Uint8Array<ArrayBufferLike> {
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data))
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (typeof data === 'string') {
    return new Uint8Array(Buffer.from(data, 'utf-8'))
  }
  return new Uint8Array(data as Buffer)
}
