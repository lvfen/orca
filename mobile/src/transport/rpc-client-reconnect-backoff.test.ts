import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './rpc-client'

vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32)
  }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'client-public-key',
  encrypt: (plaintext: string) => `encrypted:${plaintext}`,
  decrypt: (raw: string) => raw.replace(/^encrypted:/, ''),
  decryptBytes: (bytes: Uint8Array) => bytes
}))

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly endpoint: string) {
    mockSockets.push(this)
  }

  send(): void {}

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) {
      return
    }
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }
}

const mockSockets: MockWebSocket[] = []
const originalWebSocket = globalThis.WebSocket

describe('rpc-client reconnect backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSockets.length = 0
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('keeps increasing reconnect backoff until E2EE authenticates', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')

    mockSockets[0]!.open()
    vi.advanceTimersByTime(5_000)
    expect(client.getReconnectAttempt()).toBe(1)

    vi.advanceTimersByTime(500)
    mockSockets[1]!.open()
    vi.advanceTimersByTime(5_000)
    expect(client.getReconnectAttempt()).toBe(2)

    const socketsBeforeNextDelay = mockSockets.length
    vi.advanceTimersByTime(500)
    expect(mockSockets).toHaveLength(socketsBeforeNextDelay)
    vi.advanceTimersByTime(500)
    expect(mockSockets).toHaveLength(socketsBeforeNextDelay + 1)

    client.close()
  })
})
