import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RelayCloseCode } from '../src/protocol.js'
import type { RelayMetricsSnapshot } from '../src/relay-metrics.js'
import { RelayServer, type RelayServerOptions } from '../src/relay-server.js'
import { RoomStore, type Room } from '../src/room-store.js'
import { RelayTestClient } from './relay-test-client.js'

const WS_TRY_AGAIN_LATER = 1013

describe('RelayServer hardening', () => {
  let dir: string
  let storePath: string
  let store: RoomStore
  let room: Room
  let server: RelayServer | null
  let url = ''
  const clients: RelayTestClient[] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-hard-'))
    storePath = join(dir, 'rooms.json')
    store = new RoomStore(storePath)
    room = store.createPair('ws://localhost', 'my-mac')
    server = null
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close()
    }
    if (server) {
      await server.stop()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  async function startServer(overrides: Partial<RelayServerOptions> = {}): Promise<RelayServer> {
    const next = new RelayServer({
      config: { host: '127.0.0.1', port: 0, publicUrl: 'ws://localhost', storePath },
      store,
      heartbeatIntervalMs: 200,
      preJoinTimeoutMs: 5_000,
      ...overrides
    })
    await next.start()
    server = next
    url = `ws://127.0.0.1:${next.resolvedPort}`
    return next
  }

  function newClient(): RelayTestClient {
    const client = new RelayTestClient(url)
    clients.push(client)
    return client
  }

  async function openClient(): Promise<RelayTestClient> {
    const client = newClient()
    await client.open()
    return client
  }

  async function joinHost(): Promise<RelayTestClient> {
    const host = await openClient()
    host.send(JSON.stringify({ type: 'host-join', token: room.pcToken }))
    expect(await host.nextJson()).toEqual({ type: 'host-join-ack' })
    return host
  }

  async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('until: predicate did not become true in time')
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
    }
  }

  it('survives a host reconnect storm without leaking sockets or rooms', async () => {
    const active = await startServer({ maxConnectionsPerWindow: 1_000 })
    const hosts: RelayTestClient[] = []
    for (let i = 0; i < 12; i++) {
      hosts.push(await joinHost())
    }

    // Every host but the most recent was superseded (terminal, no reconnect).
    for (const superseded of hosts.slice(0, -1)) {
      expect((await superseded.waitClose()).code).toBe(RelayCloseCode.Occupied)
    }

    expect(active.liveRoomCount).toBe(1)
    await until(() => active.connectionCount === 1)
    expect(active.connectionCount).toBe(1)
    expect(active.getMetrics().superseded).toBe(11)
  })

  it('rejects connections beyond the per-IP budget with 1013', async () => {
    const active = await startServer({ maxConnectionsPerWindow: 3, rateLimitWindowMs: 60_000 })
    const accepted = [await openClient(), await openClient(), await openClient()]
    await until(() => active.connectionCount === 3)

    const rejectedA = await openClient()
    const rejectedB = await openClient()
    expect((await rejectedA.waitClose()).code).toBe(WS_TRY_AGAIN_LATER)
    expect((await rejectedB.waitClose()).code).toBe(WS_TRY_AGAIN_LATER)

    expect(active.getMetrics().connectionsRejectedRateLimited).toBe(2)
    expect(active.connectionCount).toBe(accepted.length)
  })

  it('rejects connections beyond the global concurrency cap with 1013', async () => {
    const active = await startServer({
      maxConcurrentConnections: 2,
      maxConnectionsPerWindow: 1_000
    })
    await openClient()
    await openClient()
    await until(() => active.connectionCount === 2)

    const overflow = await openClient()
    expect((await overflow.waitClose()).code).toBe(WS_TRY_AGAIN_LATER)
    expect(active.getMetrics().connectionsRejectedOverCapacity).toBe(1)
    expect(active.connectionCount).toBe(2)
  })

  it('reports join, forward, and recycle counters over /healthz', async () => {
    const active = await startServer()
    const host = await joinHost()
    const client = await openClient()
    client.send(JSON.stringify({ type: 'client-join', token: room.mobileToken }))
    expect(await client.nextJson()).toEqual({ type: 'room-ready' })
    expect(await host.nextJson()).toEqual({ type: 'peer-online' })

    client.send('e2ee-from-phone')
    expect((await host.nextMessage()).text).toBe('e2ee-from-phone')

    const response = await fetch(`http://127.0.0.1:${active.resolvedPort}/healthz`)
    expect(response.status).toBe(200)
    const metrics = (await response.json()) as RelayMetricsSnapshot
    expect(metrics.joinsHost).toBe(1)
    expect(metrics.joinsClient).toBe(1)
    expect(metrics.forwardedMessages).toBeGreaterThanOrEqual(1)
    expect(metrics.forwardedBytes).toBeGreaterThanOrEqual('e2ee-from-phone'.length)
    expect(metrics.liveRooms).toBe(1)

    // Lifecycle coupling: dropping the client recycles the host and bumps the counter.
    client.close()
    expect((await host.waitClose()).code).toBe(RelayCloseCode.PeerRecycled)
    await until(() => active.getMetrics().peerRecycled === 1)
    await until(() => active.liveRoomCount === 0)
  })

  it('answers 426 for non-health HTTP requests on the WS port', async () => {
    const active = await startServer()
    const response = await fetch(`http://127.0.0.1:${active.resolvedPort}/`)
    expect(response.status).toBe(426)
  })
})
