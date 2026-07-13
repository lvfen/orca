import { WebSocket } from 'ws'
import type { CreateInviteResult, DesktopRelayV2Status } from '../../../shared/relay-v2-desktop'

export function relayV2InviteUnavailableResult(input: {
  hasPendingInvite: boolean
  status: DesktopRelayV2Status
  ws: WebSocket | null
}): CreateInviteResult | null {
  if (input.hasPendingInvite) {
    return { ok: false, reason: 'busy', status: input.status }
  }
  if (
    input.status.state === 'certificate-required' ||
    input.status.state === 'unauthorized' ||
    input.status.state === 'relay-unavailable'
  ) {
    return { ok: false, reason: input.status.state, status: input.status }
  }
  if (!input.ws || input.ws.readyState !== WebSocket.OPEN || input.status.state !== 'connected') {
    return { ok: false, reason: 'not-connected', status: input.status }
  }
  return null
}
