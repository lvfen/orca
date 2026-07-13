import { connect } from '../transport/rpc-client'
import { getNextHostName, saveHost } from '../transport/host-store'
import type { ConnectionLogEntry, RpcResponse } from '../transport/types'
import {
  startPairingConnectionAttempt,
  type PairingConnectionAttempt
} from '../transport/pairing-connection-attempt'
import {
  RELAY_V2_PROTOCOL_VERSION,
  type RelayInviteV2Payload,
  type RelayV2MobileBindAck
} from './relay-v2-invite'
import { getOrCreateRelayV2MobileDeviceId } from './relay-v2-binding-store'
import { relayV2TrustFailureMessage } from './relay-v2-trust-failure'

const RELAY_OVERALL_TIMEOUT_MS = 30_000

export type AddRelayFlowResult =
  | { type: 'saved'; hostId: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string }

type AttemptHooks = {
  setActiveAttempt: (attempt: PairingConnectionAttempt) => void
  clearActiveAttempt: (attempt: PairingConnectionAttempt) => void
  isActiveAttempt: (attempt: PairingConnectionAttempt) => boolean
  isMounted: () => boolean
  onLog: (entry: ConnectionLogEntry) => void
}

export async function connectAndSaveRelayV2(args: {
  invite: RelayInviteV2Payload
  hooks: AttemptHooks
}): Promise<AddRelayFlowResult> {
  let client: ReturnType<typeof connect> | null = null
  const bindAckRef = { current: null as RelayV2MobileBindAck | null }
  const connectionLogs: ConnectionLogEntry[] = []
  const attempt = startPairingConnectionAttempt({
    timeoutMs: RELAY_OVERALL_TIMEOUT_MS,
    closeClient: () => client?.close()
  })
  args.hooks.setActiveAttempt(attempt)

  let response: RpcResponse
  try {
    const mobileDeviceId = await getOrCreateRelayV2MobileDeviceId()
    client = connect(args.invite.relayUrl, args.invite.deviceToken, args.invite.pcPublicKeyB64, {
      relayV2: {
        mode: 'join',
        message: {
          type: 'mobile-join',
          v: RELAY_V2_PROTOCOL_VERSION,
          channelId: args.invite.channelId,
          inviteToken: args.invite.inviteToken,
          mobileDeviceId,
          mobileName: 'Orca Mobile'
        },
        onBindAck: (ack) => {
          bindAckRef.current = ack
        }
      },
      onLog: relayV2AttemptLog(args.hooks, attempt, connectionLogs)
    })
    response = await client.sendRequest('status.get')
    if (!finishAttempt(args.hooks, attempt)) {
      return { type: 'cancelled' }
    }
  } catch (error) {
    const timedOut = attempt.timedOut
    finishAttempt(args.hooks, attempt)
    console.warn('[relay-v2] connect failed', error)
    const trustFailureMessage = relayV2TrustFailureMessage(connectionLogs)
    return {
      type: 'error',
      message:
        trustFailureMessage ??
        (timedOut
          ? `Couldn't reach your PC through relay v2 within ${
              RELAY_OVERALL_TIMEOUT_MS / 1000
            }s. See log below.`
          : 'Cannot connect through relay v2. Check the certificate, invite, and PC connection.')
    }
  }

  const bindAck = bindAckRef.current
  if (!response.ok || !bindAck) {
    return {
      type: 'error',
      message: response.ok
        ? 'Relay v2 joined but did not return a resume token'
        : response.error.code === 'unauthorized'
          ? 'Authentication failed. Rebind on the PC and try again.'
          : `Server error: ${response.error.message}`
    }
  }

  try {
    const hostId = `host-${Date.now()}`
    const hostName = await getNextHostName()
    await saveHost({
      id: hostId,
      name: hostName,
      endpoint: args.invite.relayUrl,
      deviceToken: args.invite.deviceToken,
      publicKeyB64: args.invite.pcPublicKeyB64,
      lastConnected: Date.now(),
      kind: 'relay-v2',
      mobileToken: bindAck.resumeToken,
      pcId: bindAck.pcId,
      mobileDeviceId: bindAck.mobileDeviceId,
      roomId: args.invite.channelId,
      resumeTokenExpiresAt: bindAck.resumeTokenExpiresAt,
      serverCaSha256: args.invite.serverCaSha256
    })
    return args.hooks.isMounted() ? { type: 'saved', hostId } : { type: 'cancelled' }
  } catch (error) {
    console.warn('[relay-v2] save failed', error)
    return {
      type: 'error',
      message: `Connected but couldn't save the relay v2 host: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

function relayV2AttemptLog(
  hooks: AttemptHooks,
  attempt: PairingConnectionAttempt,
  entries: ConnectionLogEntry[]
) {
  return (entry: ConnectionLogEntry): void => {
    entries.push(entry)
    if (hooks.isMounted() && hooks.isActiveAttempt(attempt)) {
      hooks.onLog(entry)
    }
  }
}

function finishAttempt(hooks: AttemptHooks, attempt: PairingConnectionAttempt): boolean {
  const current = hooks.isActiveAttempt(attempt)
  attempt.dispose()
  hooks.clearActiveAttempt(attempt)
  return hooks.isMounted() && current
}
