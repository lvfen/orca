import { describe, expect, it } from 'vitest'
import { normalizeRelayV2Url } from './relay-v2-config-store'

describe('normalizeRelayV2Url', () => {
  it('accepts bare relay addresses and defaults them to wss', () => {
    expect(normalizeRelayV2Url('relay.example.com')).toBe('wss://relay.example.com/')
    expect(normalizeRelayV2Url('49.51.37.225:6770')).toBe('wss://49.51.37.225:6770/')
  })

  it('keeps explicit websocket schemes and maps http schemes to websocket schemes', () => {
    expect(normalizeRelayV2Url('wss://relay.example.com')).toBe('wss://relay.example.com/')
    expect(normalizeRelayV2Url('ws://127.0.0.1:6770')).toBe('ws://127.0.0.1:6770/')
    expect(normalizeRelayV2Url('https://relay.example.com')).toBe('wss://relay.example.com/')
    expect(normalizeRelayV2Url('http://127.0.0.1:6770')).toBe('ws://127.0.0.1:6770/')
  })

  it('rejects unsupported URLs', () => {
    expect(normalizeRelayV2Url('')).toBeNull()
    expect(normalizeRelayV2Url('ftp://relay.example.com')).toBeNull()
    expect(normalizeRelayV2Url('wss://')).toBeNull()
  })
})
