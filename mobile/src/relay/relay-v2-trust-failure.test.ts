import { describe, expect, it } from 'vitest'
import type { ConnectionLogEntry } from '../transport/types'
import {
  RELAY_V2_IOS_FULL_TRUST_MESSAGE,
  relayV2TrustFailureMessage
} from './relay-v2-trust-failure'

function log(detail: string): ConnectionLogEntry {
  return {
    id: 'log-1',
    ts: 1,
    level: 'warn',
    message: 'WebSocket closed',
    detail
  }
}

describe('relayV2TrustFailureMessage', () => {
  it('detects iOS certificate trust failures', () => {
    expect(
      relayV2TrustFailureMessage([
        log(
          'Will attempt to reconnect: The operation could not be completed. (OSStatus error -9807.)'
        )
      ])
    ).toBe(RELAY_V2_IOS_FULL_TRUST_MESSAGE)
  })

  it('does not classify a generic close as certificate trust failure', () => {
    expect(relayV2TrustFailureMessage([log('Will attempt to reconnect')])).toBeNull()
  })
})
