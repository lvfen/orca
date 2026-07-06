import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { RELAY_V2_PROTOCOL_VERSION } from '../../../shared/relay-v2-protocol'
import { RelayV2Transport } from './relay-v2-transport'
import { isRelayV2CertificateError } from './relay-v2-transport-frames'

type PcConn = {
  socket: WebSocket
  hello: Record<string, unknown> | null
  forwarded: (string | Buffer)[]
  pings: number
  existingMobile: {
    mobileDeviceId: string
    mobileName: string
    mobileState: 'connected'
    lastSeenAt: number
  } | null
}

class FakeRelayV2 {
  private wss: WebSocketServer | null = null
  port = 0
  readonly connections: PcConn[] = []

  async start(): Promise<void> {
    const wss = new WebSocketServer({ port: 0 })
    this.wss = wss
    await new Promise<void>((resolve) => wss.once('listening', resolve))
    this.port = (wss.address() as AddressInfo).port
    wss.on('connection', (socket) => {
      const conn: PcConn = { socket, hello: null, forwarded: [], pings: 0, existingMobile: null }
      this.connections.push(conn)
      socket.on('ping', () => {
        conn.pings += 1
      })
      socket.on('message', (data, isBinary) => {
        if (!isBinary) {
          const handled = this.handleText(conn, data.toString())
          if (handled) {
            return
          }
        }
        conn.forwarded.push(isBinary ? (data as Buffer) : data.toString())
      })
    })
  }

  latest(): PcConn {
    const conn = this.connections.at(-1)
    if (!conn) {
      throw new Error('no pc connection yet')
    }
    return conn
  }

  push(message: object): void {
    this.latest().socket.send(JSON.stringify(message))
  }

  async stop(): Promise<void> {
    for (const conn of this.connections) {
      conn.socket.terminate()
    }
    const wss = this.wss
    this.wss = null
    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    }
  }

  private handleText(conn: PcConn, text: string): boolean {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(text)
    } catch {
      return false
    }
    if (parsed.type === 'pc-hello') {
      conn.hello = parsed
      conn.socket.send(
        JSON.stringify({
          type: 'pc-hello-ack',
          pcId: parsed.pcId,
          state: 'online',
          mobile: null
        })
      )
      return true
    }
    if (parsed.type === 'channel-create') {
      if (conn.existingMobile && parsed.mode === 'keep-existing') {
        conn.socket.send(
          JSON.stringify({
            type: 'channel-create-requires-confirmation',
            ...conn.existingMobile
          })
        )
        return true
      }
      conn.socket.send(
        JSON.stringify({
          type: 'channel-created',
          channelId: 'channel-1',
          inviteToken: 'invite-1',
          expiresAt: 1234,
          qrPayload: {
            v: RELAY_V2_PROTOCOL_VERSION,
            type: 'orca-relay-invite',
            relayUrl: `ws://127.0.0.1:${this.port}`,
            pcId: conn.hello?.pcId,
            channelId: 'channel-1',
            inviteToken: 'invite-1',
            pcPublicKeyB64: conn.hello?.publicKeyB64,
            serverCaSha256: 'ca-sha',
            serverCaDerB64: 'ca-der'
          }
        })
      )
      return true
    }
    return false
  }
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met within timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let relay: FakeRelayV2
let transport: RelayV2Transport | null = null

afterEach(async () => {
  if (transport) {
    await transport.stop()
    transport = null
  }
  await relay.stop()
})

function newTransport(extra?: {
  inviteTimeoutMs?: number
  keepaliveIntervalMs?: number
}): RelayV2Transport {
  transport = new RelayV2Transport({
    relayUrl: `ws://127.0.0.1:${relay.port}`,
    pcId: 'pc_1',
    pcName: 'MacBook Pro',
    pcSecret: 'secret-pc-1',
    publicKeyB64: 'public-key',
    reconnectDelaysMs: [10, 10, 10],
    connectTimeoutMs: 1_000,
    keepaliveIntervalMs: extra?.keepaliveIntervalMs,
    inviteTimeoutMs: extra?.inviteTimeoutMs ?? 1_000
  })
  return transport
}

describe('RelayV2Transport', () => {
  it('classifies stale pinned CA failures as certificate errors', () => {
    relay = new FakeRelayV2()
    expect(isRelayV2CertificateError({ code: 'CERT_SIGNATURE_FAILURE' })).toBe(true)
  })

  it('sends pc-hello and reports connected after pc-hello-ack', async () => {
    relay = new FakeRelayV2()
    await relay.start()
    const t = newTransport()
    await t.start()

    await until(() => t.getStatus().state === 'connected')
    expect(relay.latest().hello).toMatchObject({
      type: 'pc-hello',
      v: RELAY_V2_PROTOCOL_VERSION,
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'secret-pc-1',
      publicKeyB64: 'public-key'
    })
    expect(t.getStatus().mobile).toBeNull()
  })

  it('keeps the PC relay socket warm with ping frames', async () => {
    relay = new FakeRelayV2()
    await relay.start()
    const t = newTransport({ keepaliveIntervalMs: 10 })
    await t.start()

    await until(() => (relay.connections.at(-1)?.pings ?? 0) > 0)
    expect(t.getStatus().state).toBe('connected')
  })

  it('creates a PC-led invite through channel-create', async () => {
    relay = new FakeRelayV2()
    await relay.start()
    const t = newTransport()
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    const result = await t.createInvite('disconnect-existing')

    expect(result).toMatchObject({
      ok: true,
      invite: {
        channelId: 'channel-1',
        inviteToken: 'invite-1',
        qrPayload: {
          relayUrl: `ws://127.0.0.1:${relay.port}`,
          pcId: 'pc_1',
          channelId: 'channel-1',
          inviteToken: 'invite-1'
        }
      }
    })
    expect(t.getStatus().channelId).toBe('channel-1')
  })

  it('returns confirmation-required when a mobile is already bound', async () => {
    relay = new FakeRelayV2()
    await relay.start()
    const t = newTransport()
    await t.start()
    await until(() => t.getStatus().state === 'connected')
    relay.latest().existingMobile = {
      mobileDeviceId: 'mobile-1',
      mobileName: 'iPhone',
      mobileState: 'connected',
      lastSeenAt: 99
    }

    const result = await t.createInvite('keep-existing')

    expect(result).toMatchObject({
      ok: false,
      reason: 'confirmation-required',
      existingMobile: {
        mobileDeviceId: 'mobile-1',
        mobileName: 'iPhone',
        mobileState: 'connected'
      }
    })
  })

  it('updates mobile state and forwards non-control frames to the runtime handler', async () => {
    relay = new FakeRelayV2()
    await relay.start()
    const t = newTransport()
    const received: string[] = []
    t.onMessage((msg) => {
      if (typeof msg === 'string') {
        received.push(msg)
      }
    })
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.push({
      type: 'mobile-state',
      state: 'connected',
      mobileDeviceId: 'mobile-1',
      mobileName: 'iPhone',
      lastSeenAt: 101
    })
    relay.latest().socket.send(JSON.stringify({ type: 'e2ee_hello', publicKeyB64: 'mobile' }))

    await until(() => received.length === 1)
    expect(t.getStatus().mobile).toMatchObject({
      mobileDeviceId: 'mobile-1',
      mobileName: 'iPhone',
      state: 'connected',
      lastSeenAt: 101
    })
    expect(JSON.parse(received[0]!)).toEqual({ type: 'e2ee_hello', publicKeyB64: 'mobile' })
  })

  it('rejects invite creation before the PC socket is connected', async () => {
    relay = new FakeRelayV2()
    await relay.start()
    const t = newTransport()

    await expect(t.createInvite('keep-existing')).resolves.toMatchObject({
      ok: false,
      reason: 'not-connected'
    })
  })
})
