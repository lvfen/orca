import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RelayCloseCode } from '../src/protocol.js'
import { RelayServer } from '../src/relay-server.js'
import { RoomStore, type Room } from '../src/room-store.js'
import { RelayTestClient } from './relay-test-client.js'

describe('RelayServer end-to-end', () => {
  let dir: string
  let store: RoomStore
  let room: Room
  let server: RelayServer
  let url: string
  const clients: RelayTestClient[] = []

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-e2e-'))
    const storePath = join(dir, 'rooms.json')
    store = new RoomStore(storePath)
    room = store.createPair('ws://localhost', 'my-mac')
    server = new RelayServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        publicUrl: 'ws://localhost',
        storePath,
        accessToken: 'test-access-token'
      },
      store,
      // Why: aggressive heartbeat + short pre-join window so the timeout cases
      // resolve fast; clients auto-pong so they stay alive across sweeps.
      heartbeatIntervalMs: 50,
      preJoinTimeoutMs: 400
    })
    await server.start()
    url = `ws://127.0.0.1:${server.resolvedPort}`
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close()
    }
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  function newClient(): RelayTestClient {
    const client = new RelayTestClient(url)
    clients.push(client)
    return client
  }

  async function joinHost(): Promise<RelayTestClient> {
    const host = newClient()
    await host.open()
    host.send(JSON.stringify({ type: 'host-join', token: room.pcToken }))
    expect(await host.nextJson()).toEqual({ type: 'host-join-ack' })
    return host
  }

  async function joinPairedClient(): Promise<RelayTestClient> {
    const client = newClient()
    await client.open()
    client.send(JSON.stringify({ type: 'client-join', token: room.mobileToken }))
    expect(await client.nextJson()).toEqual({ type: 'room-ready' })
    return client
  }

  it('acks a host join and keeps it waiting while no client is online', async () => {
    await joinHost()
    expect(server.resolvedPort).toBeGreaterThan(0)
  })

  it('pairs host + client and forwards opaque frames verbatim both ways', async () => {
    const host = await joinHost()
    const client = await joinPairedClient()
    expect(await host.nextJson()).toEqual({ type: 'peer-online' })

    client.send('e2ee_hello:from-phone')
    expect((await host.nextMessage()).text).toBe('e2ee_hello:from-phone')

    host.send('e2ee_ready:from-desktop')
    expect((await client.nextMessage()).text).toBe('e2ee_ready:from-desktop')

    host.send(Buffer.from([1, 2, 3, 4]))
    const binary = await client.nextMessage()
    expect(binary.binary ? Array.from(binary.binary) : null).toEqual([1, 2, 3, 4])
  })

  it('tells a lone client the host is offline, then promotes it when a host binds', async () => {
    const client = newClient()
    await client.open()
    client.send(JSON.stringify({ type: 'client-join', token: room.mobileToken }))
    expect(await client.nextJson()).toEqual({ type: 'host-offline' })

    const host = await joinHost()
    expect(await client.nextJson()).toEqual({ type: 'room-ready' })
    expect(await host.nextJson()).toEqual({ type: 'peer-online' })
  })

  it('rejects an unknown token with 4401 unauthorized', async () => {
    const client = newClient()
    await client.open()
    client.send(JSON.stringify({ type: 'host-join', token: 'orca-pc_bogus' }))
    expect((await client.waitClose()).code).toBe(RelayCloseCode.Unauthorized)
  })

  it('rejects a role/token mismatch with 4401 unauthorized', async () => {
    const client = newClient()
    await client.open()
    client.send(JSON.stringify({ type: 'host-join', token: room.mobileToken }))
    expect((await client.waitClose()).code).toBe(RelayCloseCode.Unauthorized)
  })

  it('rejects a malformed first frame with 4400 bad-join', async () => {
    const client = newClient()
    await client.open()
    client.send('not json at all')
    expect((await client.waitClose()).code).toBe(RelayCloseCode.BadJoin)
  })

  it('supersedes the old host with 4409 occupied and re-pairs the client', async () => {
    const host1 = await joinHost()
    const client = await joinPairedClient()
    expect(await host1.nextJson()).toEqual({ type: 'peer-online' })

    const host2 = newClient()
    await host2.open()
    host2.send(JSON.stringify({ type: 'host-join', token: room.pcToken }))
    expect(await host2.nextJson()).toEqual({ type: 'host-join-ack' })

    expect((await host1.waitClose()).code).toBe(RelayCloseCode.Occupied)

    // The client is NOT recycled — it re-pairs to the new host.
    expect(await client.nextJson()).toEqual({ type: 'room-ready' })
    expect(await host2.nextJson()).toEqual({ type: 'peer-online' })

    client.send('hello-host2')
    expect((await host2.nextMessage()).text).toBe('hello-host2')
  })

  it('recycles the paired socket with 4408 when one side drops', async () => {
    const host = await joinHost()
    const client = await joinPairedClient()
    expect(await host.nextJson()).toEqual({ type: 'peer-online' })

    client.close()
    expect((await host.waitClose()).code).toBe(RelayCloseCode.PeerRecycled)
  })

  it('terminates a socket that never sends a join frame', async () => {
    const client = newClient()
    await client.open()
    expect((await client.waitClose(2_000)).code).toBe(RelayCloseCode.BadJoin)
  })
})
