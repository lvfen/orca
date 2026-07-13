import { classifyConnection } from '../transport/connection-health'
import type { ConnectionState } from '../transport/types'

export type RelayV2ReconnectAction = 'retry' | 'repair' | 'remove'

export type RelayV2ReconnectPresentation = {
  severity: 'info' | 'warning' | 'error'
  title: string
  message: string
  actions: RelayV2ReconnectAction[]
  showSpinner: boolean
}

const RESUME_TOKEN_EXPIRY_SKEW_MS = 30_000

export function resolveRelayV2ReconnectPresentation(args: {
  state: ConnectionState
  reconnectAttempts: number
  lastConnectedAt: number | null
  resumeTokenExpiresAt?: number | null
  nowMs?: number
}): RelayV2ReconnectPresentation | null {
  const nowMs = args.nowMs ?? Date.now()

  if (
    args.resumeTokenExpiresAt != null &&
    args.resumeTokenExpiresAt - nowMs <= RESUME_TOKEN_EXPIRY_SKEW_MS
  ) {
    return {
      severity: 'error',
      title: 'Relay session expired',
      message: 'Scan a new relay QR from the PC to renew this phone connection.',
      actions: ['repair', 'remove'],
      showSpinner: false
    }
  }

  if (args.state === 'connected' || args.state === 'connecting' || args.state === 'handshaking') {
    return null
  }

  if (args.state === 'auth-failed') {
    return {
      severity: 'error',
      title: 'Pairing needs attention',
      message: 'Retry once. If it still fails, generate a new relay QR on the PC.',
      actions: ['retry', 'repair', 'remove'],
      showSpinner: false
    }
  }

  if (args.state === 'occupied') {
    return {
      severity: 'error',
      title: 'Phone connection was replaced',
      message: 'This relay pairing is active somewhere else. Re-pair from the PC to reclaim it.',
      actions: ['repair', 'remove'],
      showSpinner: false
    }
  }

  if (args.state === 'disconnected') {
    return {
      severity: 'warning',
      title: 'Relay disconnected',
      message: 'Connect again when this phone and the PC can reach the relay server.',
      actions: ['retry', 'repair', 'remove'],
      showSpinner: false
    }
  }

  const verdict = classifyConnection({
    state: args.state,
    reconnectAttempts: args.reconnectAttempts,
    lastConnectedAt: args.lastConnectedAt,
    nowMs
  })

  if (verdict.kind === 'unreachable') {
    return {
      severity: 'error',
      title: "Can't reach the PC through relay",
      message:
        verdict.reason === 'never-connected'
          ? 'This phone has not completed a relay v2 resume in this app session.'
          : 'The previous relay session has been offline for over a minute.',
      actions: ['retry', 'repair', 'remove'],
      showSpinner: false
    }
  }

  if (verdict.kind === 'warning') {
    return {
      severity: 'warning',
      title: 'Still reconnecting',
      message: `Relay resume is retrying. Attempt ${args.reconnectAttempts}.`,
      actions: ['retry', 'repair'],
      showSpinner: true
    }
  }

  return {
    severity: 'info',
    title: 'Reconnecting through relay',
    message: 'Network changes or app suspension can interrupt the phone socket.',
    actions: ['retry'],
    showSpinner: true
  }
}
