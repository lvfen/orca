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
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: ((event?: { code?: number }) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  emitCloseOnClose = true
  sent: string[] = []
  close = vi.fn((code?: number) => {
    if (this.readyState === MockWebSocket.CLOSED) {
      return
    }
    this.readyState = MockWebSocket.CLOSED
    if (this.emitCloseOnClose) {
      this.onclose?.({ code })
    }
  })

  constructor(readonly endpoint: string) {
    mockSockets.push(this)
  }

  send(payload: string): void {
    this.sent.push(payload)
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: payload })
  }

  // Why: simulate the relay closing the socket with a specific reason code
  // (4409/4408/4401) without the client having asked to close.
  closeFromServer(code: number): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code })
  }
}

const mockSockets: MockWebSocket[] = []
const originalWebSocket = globalThis.WebSocket

function sentPlain(socket: MockWebSocket, type: string): boolean {
  return socket.sent.some((payload) => {
    if (payload.startsWith('encrypted:')) {
      return false
    }
    try {
      return (JSON.parse(payload) as { type?: string }).type === type
    } catch {
      return false
    }
  })
}

function sentEncrypted(socket: MockWebSocket, type: string): boolean {
  return socket.sent.some((payload) => {
    if (!payload.startsWith('encrypted:')) {
      return false
    }
    try {
      return (JSON.parse(payload.slice('encrypted:'.length)) as { type?: string }).type === type
    } catch {
      return false
    }
  })
}

function authenticate(socket: MockWebSocket): void {
  socket.receive(JSON.stringify({ type: 'e2ee_ready' }))
  socket.receive(`encrypted:${JSON.stringify({ type: 'e2ee_authenticated' })}`)
}

describe('rpc-client relay pre-handshake', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSockets.length = 0
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('sends client-join and defers the E2EE hello until room-ready', () => {
    const client = connect('wss://relay.example', 'dev-token', 'server-key', {
      relay: { mobileToken: 'orca-mb_abc' }
    })
    const socket = mockSockets[0]!

    socket.open()
    expect(sentPlain(socket, 'client-join')).toBe(true)
    // Why: E2EE bytes must not flow before the room is claimed.
    expect(sentPlain(socket, 'e2ee_hello')).toBe(false)
    expect(client.getState()).toBe('handshaking')

    socket.receive(JSON.stringify({ type: 'room-ready' }))
    expect(sentPlain(socket, 'e2ee_hello')).toBe(true)

    authenticate(socket)
    expect(client.getState()).toBe('connected')
    expect(sentEncrypted(socket, 'e2ee_auth')).toBe(true)

    client.close()
  })

  it('keeps waiting on host-offline, then proceeds once room-ready arrives', () => {
    const client = connect('wss://relay.example', 'dev-token', 'server-key', {
      relay: { mobileToken: 'orca-mb_abc' }
    })
    const socket = mockSockets[0]!

    socket.open()
    socket.receive(JSON.stringify({ type: 'host-offline' }))
    expect(sentPlain(socket, 'e2ee_hello')).toBe(false)
    expect(client.getState()).toBe('handshaking')

    socket.receive(JSON.stringify({ type: 'room-ready' }))
    authenticate(socket)
    expect(client.getState()).toBe('connected')

    client.close()
  })

  it('recycles the socket and reconnects if room-ready never arrives', () => {
    const client = connect('wss://relay.example', 'dev-token', 'server-key', {
      relay: { mobileToken: 'orca-mb_abc' }
    })
    const socket = mockSockets[0]!
    socket.open()
    expect(mockSockets).toHaveLength(1)

    vi.advanceTimersByTime(12_000)
    expect(socket.close).toHaveBeenCalled()
    expect(client.getState()).toBe('reconnecting')

    vi.advanceTimersByTime(500)
    expect(mockSockets.length).toBeGreaterThan(1)

    client.close()
  })

  it('treats 4409 occupied as terminal — no reconnect', () => {
    const states: string[] = []
    const client = connect('wss://relay.example', 'dev-token', 'server-key', {
      relay: { mobileToken: 'orca-mb_abc' },
      onStateChange: (s) => states.push(s)
    })
    const socket = mockSockets[0]!
    socket.open()
    socket.receive(JSON.stringify({ type: 'room-ready' }))
    authenticate(socket)
    expect(client.getState()).toBe('connected')

    socket.closeFromServer(4409)
    expect(client.getState()).toBe('occupied')

    vi.advanceTimersByTime(120_000)
    expect(mockSockets).toHaveLength(1)
    expect(states).toContain('occupied')

    client.close()
  })

  it('treats 4401 unauthorized as terminal auth-failed — no reconnect', () => {
    const client = connect('wss://relay.example', 'dev-token', 'server-key', {
      relay: { mobileToken: 'orca-mb_abc' }
    })
    const socket = mockSockets[0]!
    socket.open()
    socket.closeFromServer(4401)

    expect(client.getState()).toBe('auth-failed')
    vi.advanceTimersByTime(120_000)
    expect(mockSockets).toHaveLength(1)

    client.close()
  })

  it('reconnects after 4408 peer-recycled', () => {
    const client = connect('wss://relay.example', 'dev-token', 'server-key', {
      relay: { mobileToken: 'orca-mb_abc' }
    })
    const socket = mockSockets[0]!
    socket.open()
    socket.receive(JSON.stringify({ type: 'room-ready' }))
    authenticate(socket)
    expect(client.getState()).toBe('connected')

    socket.closeFromServer(4408)
    expect(client.getState()).toBe('reconnecting')

    vi.advanceTimersByTime(500)
    expect(mockSockets.length).toBeGreaterThan(1)

    client.close()
  })

  it('does not run the relay pre-handshake for LAN hosts', () => {
    const client = connect('ws://desktop.lan:6768', 'dev-token', 'server-key')
    const socket = mockSockets[0]!
    socket.open()
    // LAN: e2ee_hello goes out immediately, no client-join.
    expect(sentPlain(socket, 'client-join')).toBe(false)
    expect(sentPlain(socket, 'e2ee_hello')).toBe(true)

    client.close()
  })
})
