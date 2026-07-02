import { describe, expect, it } from 'vitest'
import { classifyConnection } from './connection-health'

describe('classifyConnection occupied', () => {
  it('maps the occupied state to a terminal occupied verdict', () => {
    expect(
      classifyConnection({ state: 'occupied', reconnectAttempts: 0, lastConnectedAt: Date.now() })
    ).toEqual({ kind: 'occupied', label: 'Taken over' })
  })

  it('keeps auth-failed and connected verdicts distinct from occupied', () => {
    expect(
      classifyConnection({ state: 'auth-failed', reconnectAttempts: 0, lastConnectedAt: null }).kind
    ).toBe('auth-failed')
    expect(
      classifyConnection({ state: 'connected', reconnectAttempts: 0, lastConnectedAt: Date.now() })
        .kind
    ).toBe('normal')
  })
})
