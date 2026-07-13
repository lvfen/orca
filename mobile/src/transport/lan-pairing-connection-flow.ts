import { connect } from './rpc-client'
import { getNextHostName, saveHost } from './host-store'
import {
  startPairingConnectionAttempt,
  type PairingConnectionAttempt
} from './pairing-connection-attempt'
import type { ConnectionLogEntry, PairingOffer, RpcResponse } from './types'

// Why: cap initial-pair "Connecting..." so a broken route surfaces as a real
// error with the log visible instead of a silent infinite spinner.
const PAIRING_OVERALL_TIMEOUT_MS = 25_000

export type LanPairingFlowResult =
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

export async function connectAndSaveLanPairing(args: {
  offer: PairingOffer
  hooks: AttemptHooks
}): Promise<LanPairingFlowResult> {
  let client: ReturnType<typeof connect> | null = null
  const attempt = startPairingConnectionAttempt({
    timeoutMs: PAIRING_OVERALL_TIMEOUT_MS,
    closeClient: () => client?.close()
  })
  args.hooks.setActiveAttempt(attempt)

  let response: RpcResponse
  try {
    client = connect(args.offer.endpoint, args.offer.deviceToken, args.offer.publicKeyB64, {
      onLog: scopedLog(args.hooks, attempt)
    })
    response = await client.sendRequest('status.get')
    if (!finishAttempt(args.hooks, attempt)) {
      return { type: 'cancelled' }
    }
  } catch (error) {
    const timedOut = attempt.timedOut
    finishAttempt(args.hooks, attempt)
    console.warn('[pair] connect failed', error)
    return {
      type: 'error',
      message: timedOut
        ? `Couldn't connect within ${PAIRING_OVERALL_TIMEOUT_MS / 1000}s - see log below for where it stalled`
        : 'Cannot connect - check that your computer is on the same network'
    }
  }

  if (!response.ok) {
    return {
      type: 'error',
      message:
        response.error.code === 'unauthorized'
          ? 'Authentication failed - token may be expired'
          : `Server error: ${response.error.message}`
    }
  }

  try {
    const hostId = `host-${Date.now()}`
    const hostName = await getNextHostName()
    await saveHost({
      id: hostId,
      name: hostName,
      endpoint: args.offer.endpoint,
      deviceToken: args.offer.deviceToken,
      publicKeyB64: args.offer.publicKeyB64,
      lastConnected: Date.now(),
      kind: 'lan'
    })
    return args.hooks.isMounted() ? { type: 'saved', hostId } : { type: 'cancelled' }
  } catch (error) {
    console.warn('[pair] save failed', error)
    return {
      type: 'error',
      message: `Pairing succeeded but couldn't save the host: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

function scopedLog(hooks: AttemptHooks, attempt: PairingConnectionAttempt) {
  return (entry: ConnectionLogEntry): void => {
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
