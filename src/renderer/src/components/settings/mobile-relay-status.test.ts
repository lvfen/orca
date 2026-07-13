import { describe, expect, it } from 'vitest'
import type { RelayConnectionState } from '@/../../shared/relay-protocol'
import { isRelayTerminalState, relayStatusTone } from './mobile-relay-status'

describe('relayStatusTone', () => {
  it('maps each relay connection state to a tone', () => {
    const cases: Record<RelayConnectionState, ReturnType<typeof relayStatusTone>> = {
      connected: 'connected',
      connecting: 'pending',
      reconnecting: 'pending',
      occupied: 'danger',
      unauthorized: 'danger',
      disconnected: 'idle'
    }
    for (const [state, tone] of Object.entries(cases) as [
      RelayConnectionState,
      ReturnType<typeof relayStatusTone>
    ][]) {
      expect(relayStatusTone(state)).toBe(tone)
    }
  })
})

describe('isRelayTerminalState', () => {
  it('treats occupied and unauthorized as terminal', () => {
    expect(isRelayTerminalState('occupied')).toBe(true)
    expect(isRelayTerminalState('unauthorized')).toBe(true)
  })

  it('treats recoverable/idle states as non-terminal', () => {
    expect(isRelayTerminalState('connected')).toBe(false)
    expect(isRelayTerminalState('connecting')).toBe(false)
    expect(isRelayTerminalState('reconnecting')).toBe(false)
    expect(isRelayTerminalState('disconnected')).toBe(false)
  })
})
