import { describe, expect, it } from 'vitest'
import {
  appendRelayV2ConnectionLog,
  formatRelayV2ConnectionLogEntry
} from './relay-v2-connection-log'
import { resolveRelayV2ReconnectPresentation } from './relay-v2-reconnect-state-machine'

describe('resolveRelayV2ReconnectPresentation', () => {
  it('stays quiet while connected or actively handshaking', () => {
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'connected',
        reconnectAttempts: 0,
        lastConnectedAt: Date.now()
      })
    ).toBeNull()
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'handshaking',
        reconnectAttempts: 0,
        lastConnectedAt: null
      })
    ).toBeNull()
  })

  it('prompts for re-pair before an existing resume token expires', () => {
    const nowMs = 1_000_000
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'reconnecting',
        reconnectAttempts: 1,
        lastConnectedAt: nowMs - 10_000,
        resumeTokenExpiresAt: nowMs + 20_000,
        nowMs
      })
    ).toMatchObject({
      severity: 'error',
      title: 'Relay session expired',
      actions: ['repair', 'remove'],
      showSpinner: false
    })
  })

  it('shows a lightweight retry while auto-resume is still early', () => {
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'reconnecting',
        reconnectAttempts: 1,
        lastConnectedAt: null,
        nowMs: 1_000
      })
    ).toMatchObject({
      severity: 'info',
      actions: ['retry'],
      showSpinner: true
    })
  })

  it('escalates long reconnect runs into retry and repair actions', () => {
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'reconnecting',
        reconnectAttempts: 12,
        lastConnectedAt: null,
        nowMs: 1_000
      })
    ).toMatchObject({
      severity: 'error',
      title: "Can't reach the PC through relay",
      actions: ['retry', 'repair', 'remove'],
      showSpinner: false
    })
  })

  it('keeps occupied terminal and auth-failed repair paths distinct', () => {
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'occupied',
        reconnectAttempts: 0,
        lastConnectedAt: null
      })
    ).toMatchObject({
      title: 'Phone connection was replaced',
      actions: ['repair', 'remove']
    })
    expect(
      resolveRelayV2ReconnectPresentation({
        state: 'auth-failed',
        reconnectAttempts: 0,
        lastConnectedAt: null
      })
    ).toMatchObject({
      title: 'Pairing needs attention',
      actions: ['retry', 'repair', 'remove']
    })
  })
})

describe('relay v2 connection log', () => {
  it('keeps the newest entries under the cap', () => {
    const out = appendRelayV2ConnectionLog(
      [
        { id: '1', ts: 1, level: 'info', message: 'first' },
        { id: '2', ts: 2, level: 'warn', message: 'second' }
      ],
      { id: '3', ts: 3, level: 'success', message: 'third' },
      2
    )

    expect(out.map((entry) => entry.id)).toEqual(['2', '3'])
  })

  it('formats optional detail without losing the phase label', () => {
    expect(
      formatRelayV2ConnectionLogEntry({
        id: '1',
        ts: 1,
        level: 'info',
        message: 'Relay v2 channel resumed',
        detail: 'Starting E2EE handshake'
      })
    ).toBe('Relay v2 channel resumed: Starting E2EE handshake')
  })
})
