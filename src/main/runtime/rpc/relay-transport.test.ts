import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { RelayCloseCode } from '../../../shared/relay-protocol'
import { RelayTransport, type RelayStatus } from './relay-transport'

type HostConn = {
  socket: WebSocket
  joinToken: string | null
  // Frames received AFTER the host-join (i.e. forwarded E2EE traffic).
  forwarded: (string | Buffer)[]
}

// Why: a minimal stand-in for the relay server that speaks just enough of the
// host side of the wire contract (host-join → host-join-ack, control pushes,
// close codes) to exercise the desktop transport in isolation.
class FakeRelay {
  private wss: WebSocketServer | null = null
  port = 0
  readonly connections: HostConn[] = []

  async start(): Promise<void> {
    const wss = new WebSocketServer({ port: 0 })
    this.wss = wss
    await new Promise<void>((resolve) => wss.once('listening', resolve))
    this.port = (wss.address() as AddressInfo).port
    wss.on('connection', (socket) => {
      const conn: HostConn = { socket, joinToken: null, forwarded: [] }
      this.connections.push(conn)
      socket.on('message', (data, isBinary) => {
        if (conn.joinToken === null && !isBinary) {
          try {
            const frame = JSON.parse(data.toString()) as { type?: string; token?: string }
            if (frame.type === 'host-join' && typeof frame.token === 'string') {
              conn.joinToken = frame.token
              socket.send(JSON.stringify({ type: 'host-join-ack' }))
              return
            }
          } catch {
            // fall through and record as forwarded
          }
        }
        conn.forwarded.push(isBinary ? (data as Buffer) : data.toString())
      })
    })
  }

  latest(): HostConn {
    const conn = this.connections.at(-1)
    if (!conn) {
      throw new Error('no host connection yet')
    }
    return conn
  }

  push(frame: object): void {
    this.latest().socket.send(JSON.stringify(frame))
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
}

function makePcToken(port: number): string {
  const payload = { relayUrl: `ws://127.0.0.1:${port}`, roomId: 'room-1', secret: 's3cret' }
  return `orca-pc_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
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

let relay: FakeRelay
let transport: RelayTransport | null = null

afterEach(async () => {
  if (transport) {
    await transport.stop()
    transport = null
  }
  await relay.stop()
})

function newTransport(extra?: { connectTimeoutMs?: number }): RelayTransport {
  transport = new RelayTransport({
    pcToken: makePcToken(relay.port),
    reconnectDelaysMs: [10, 10, 10],
    connectTimeoutMs: extra?.connectTimeoutMs ?? 1_000
  })
  return transport
}

describe('RelayTransport', () => {
  it('joins the relay and reports connected after host-join-ack', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    const statuses: RelayStatus[] = []
    t.onStatusChange((s) => statuses.push(s))
    await t.start()

    await until(() => t.getStatus().state === 'connected')
    expect(relay.connections).toHaveLength(1)
    expect(relay.latest().joinToken).toBe(makePcToken(relay.port))
    expect(statuses.map((s) => s.state)).toContain('connecting')
    expect(t.getStatus().phoneOnline).toBe(false)
  })

  it('forwards relay traffic to the message handler and replies back over the same socket', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    const received: { text: string; bytes: number[] }[] = []
    t.onMessage((msg, _reply, ws) => {
      if (typeof msg === 'string') {
        received.push({ text: msg, bytes: [] })
        ws.send('reply-over-socket')
      } else {
        received.push({ text: '', bytes: Array.from(msg) })
      }
    })
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.latest().socket.send(JSON.stringify({ type: 'e2ee_hello', publicKeyB64: 'abc' }))
    relay.latest().socket.send(Buffer.from([1, 2, 3]), { binary: true })

    await until(() => received.length >= 2)
    expect(received[0]!.text).toContain('e2ee_hello')
    expect(received[1]!.bytes).toEqual([1, 2, 3])
    await until(() => relay.latest().forwarded.includes('reply-over-socket'))
  })

  it('does not forward relay control frames to the message handler', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    const received: unknown[] = []
    t.onMessage((msg) => received.push(msg))
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.push({ type: 'peer-online' })
    await until(() => t.getStatus().phoneOnline)
    expect(received).toHaveLength(0)
  })

  it('reconnects after a recoverable peer-recycled close', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.latest().socket.close(RelayCloseCode.PeerRecycled, 'peer-recycled')
    await until(() => relay.connections.length === 2)
    await until(() => t.getStatus().state === 'connected')
    expect(relay.connections[1]!.joinToken).toBe(makePcToken(relay.port))
  })

  it('stops reconnecting and reports occupied on a 4409 close', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.latest().socket.close(RelayCloseCode.Occupied, 'occupied')
    await until(() => t.getStatus().state === 'occupied')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(relay.connections).toHaveLength(1)
  })

  it('reports unauthorized terminally on a 4401 close', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.latest().socket.close(RelayCloseCode.Unauthorized, 'unauthorized')
    await until(() => t.getStatus().state === 'unauthorized')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(relay.connections).toHaveLength(1)
  })

  it('fires onConnectionClose with the bound client id on every socket close', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    const closes: (string | null)[] = []
    t.onConnectionClose((clientId) => closes.push(clientId))
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    // Simulate the runtime binding a device token to the live socket.
    t.onMessage((_msg, _reply, ws) => t.setClientId(ws, 'device-token-xyz'))
    relay.latest().socket.send(JSON.stringify({ type: 'e2ee_hello' }))
    await until(() => relay.connections.length >= 1)

    relay.latest().socket.close(RelayCloseCode.PeerRecycled, 'recycle')
    await until(() => closes.length === 1)
    expect(closes[0]).toBe('device-token-xyz')
  })

  it('recycles the socket when a second phone takes the slot', async () => {
    relay = new FakeRelay()
    await relay.start()
    const t = newTransport()
    await t.start()
    await until(() => t.getStatus().state === 'connected')

    relay.push({ type: 'peer-online' })
    await until(() => t.getStatus().phoneOnline)
    // A second peer-online on the SAME host socket means a new phone session;
    // the transport recycles the socket so the next handshake is fresh.
    relay.push({ type: 'peer-online' })
    await until(() => relay.connections.length === 2)
    await until(() => t.getStatus().state === 'connected')
  })

  it('reports unauthorized without dialing when the PC token is invalid', async () => {
    relay = new FakeRelay()
    await relay.start()
    transport = new RelayTransport({ pcToken: 'not-a-valid-token' })
    await transport.start()
    expect(transport.getStatus().state).toBe('unauthorized')
    expect(relay.connections).toHaveLength(0)
  })
})
