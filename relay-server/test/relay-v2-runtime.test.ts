import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RelayCloseCode } from '../src/protocol.js'
import { RelayServer } from '../src/relay-server.js'
import { RoomStore } from '../src/room-store.js'
import { RELAY_V2_PROTOCOL_VERSION } from '../src/v2/relay-v2-protocol.js'
import { RelayV2Store } from '../src/v2/relay-v2-store.js'
import { RelayTestClient } from './relay-test-client.js'

type ChannelCreated = {
  type: 'channel-created'
  channelId: string
  inviteToken: string
  expiresAt: number
  qrPayload: {
    relayUrl: string
    pcId: string
    channelId: string
    inviteToken: string
    pcPublicKeyB64: string
    serverCaSha256: string
    serverCaDerB64: string
  }
}

type MobileBindAck = {
  type: 'mobile-bind-ack'
  pcId: string
  mobileDeviceId: string
  resumeToken: string
  resumeTokenExpiresAt: number
}

describe('RelayServer v2 runtime', () => {
  let dir: string
  let storePath: string
  let v2StorePath: string
  let server: RelayServer
  let v2Store: RelayV2Store
  let url: string
  const clients: RelayTestClient[] = []

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-v2-runtime-'))
    storePath = join(dir, 'rooms.json')
    v2StorePath = join(dir, 'relay-v2.json')
    server = createServer()
    await startServer()
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close()
    }
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a PC-led channel, binds a mobile, and forwards opaque frames', async () => {
    const pc = await connectPc('pc_1', 'MacBook Pro')
    const created = await createChannel(pc, 'disconnect-existing')

    expect(created.qrPayload).toMatchObject({
      relayUrl: 'wss://relay.example.test',
      pcId: 'pc_1',
      channelId: created.channelId,
      inviteToken: created.inviteToken,
      pcPublicKeyB64: 'pub-pc_1',
      serverCaSha256: 'ca-sha',
      serverCaDerB64: 'ca-der'
    })

    const { mobile } = await joinMobile(created, 'mobile_1', 'iPhone 15')
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'connected',
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone 15'
    })

    mobile.send('e2ee_hello:from-phone')
    expect((await pc.nextMessage()).text).toBe('e2ee_hello:from-phone')

    pc.send(Buffer.from([9, 8, 7]))
    expect(Array.from((await mobile.nextMessage()).binary ?? [])).toEqual([9, 8, 7])
  })

  it('rejects a PC without the server access token before registering its identity', async () => {
    const pc = newClient()
    await pc.open()
    pc.send(
      JSON.stringify({
        type: 'pc-hello',
        v: RELAY_V2_PROTOCOL_VERSION,
        pcId: 'pc_intruder',
        pcName: 'Intruder',
        pcSecret: 'self-issued-secret',
        accessToken: 'wrong-access-token',
        publicKeyB64: 'self-issued-key'
      })
    )

    expect((await pc.waitClose()).code).toBe(RelayCloseCode.Unauthorized)
    expect(v2Store.getPc('pc_intruder')).toBeNull()
  })

  it('keeps independent PC/mobile channels isolated', async () => {
    const pc1 = await connectPc('pc_1', 'MacBook Pro')
    const pc2 = await connectPc('pc_2', 'Linux Workstation')
    const channel1 = await createChannel(pc1, 'disconnect-existing')
    const channel2 = await createChannel(pc2, 'disconnect-existing')
    const { mobile: mobile1 } = await joinMobile(channel1, 'mobile_1', 'iPhone')
    const { mobile: mobile2 } = await joinMobile(channel2, 'mobile_2', 'Android')
    await pc1.nextJson()
    await pc2.nextJson()

    mobile1.send('phone-1')
    mobile2.send('phone-2')

    expect((await pc1.nextMessage()).text).toBe('phone-1')
    expect((await pc2.nextMessage()).text).toBe('phone-2')
    await expect(pc1.nextMessage(80)).rejects.toThrow('Timed out')
    await expect(pc2.nextMessage(80)).rejects.toThrow('Timed out')
  })

  it('allows mobile resume during the reconnecting window and reports offline later', async () => {
    const pc = await connectPc('pc_1', 'MacBook Pro')
    const created = await createChannel(pc, 'disconnect-existing')
    const { mobile, ack: bound } = await joinMobile(created, 'mobile_1', 'iPhone 15')
    await pc.nextJson()

    mobile.close()
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'reconnecting',
      mobileDeviceId: 'mobile_1'
    })

    const resumed = await resumeMobile('pc_1', 'mobile_1', bound.resumeToken)
    expect(await resumed.nextJson()).toEqual({
      type: 'mobile-resume-ack',
      pcId: 'pc_1',
      mobileDeviceId: 'mobile_1'
    })
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'connected',
      mobileDeviceId: 'mobile_1'
    })

    resumed.close()
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'reconnecting',
      mobileDeviceId: 'mobile_1'
    })
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'offline',
      mobileDeviceId: 'mobile_1'
    })
  })

  it('restores mobile binding metadata after restart and lets the mobile resume', async () => {
    const pc = await connectPc('pc_1', 'MacBook Pro')
    const created = await createChannel(pc, 'disconnect-existing')
    const { mobile, ack: bound } = await joinMobile(created, 'mobile_1', 'iPhone 15')
    await pc.nextJson()

    mobile.close()
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'reconnecting',
      mobileDeviceId: 'mobile_1'
    })
    pc.close()
    await restartServer()

    const pcAfterRestart = await connectPc('pc_1', 'MacBook Pro', {
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone 15',
      state: 'reconnecting'
    })
    const resumed = await resumeMobile('pc_1', 'mobile_1', bound.resumeToken)
    expect(await resumed.nextJson()).toEqual({
      type: 'mobile-resume-ack',
      pcId: 'pc_1',
      mobileDeviceId: 'mobile_1'
    })
    expect(await pcAfterRestart.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'connected',
      mobileDeviceId: 'mobile_1'
    })
  })

  it('requires confirmation before replacing an existing mobile binding', async () => {
    const pc = await connectPc('pc_1', 'MacBook Pro')
    const created = await createChannel(pc, 'disconnect-existing')
    const { mobile } = await joinMobile(created, 'mobile_1', 'iPhone 15')
    await pc.nextJson()

    pc.send(JSON.stringify({ type: 'channel-create', mode: 'keep-existing' }))
    expect(await pc.nextJson()).toMatchObject({
      type: 'channel-create-requires-confirmation',
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone 15',
      mobileState: 'connected'
    })

    pc.send(JSON.stringify({ type: 'channel-create', mode: 'disconnect-existing' }))
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'revoked',
      mobileDeviceId: 'mobile_1'
    })
    const replacement = (await pc.nextJson()) as ChannelCreated
    expect(replacement.type).toBe('channel-created')
    expect(replacement.channelId).not.toBe(created.channelId)
    expect((await mobile.waitClose()).code).toBe(RelayCloseCode.Unauthorized)
  })

  function createServer(): RelayServer {
    v2Store = new RelayV2Store(v2StorePath)
    return new RelayServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        publicUrl: 'wss://relay.example.test',
        storePath,
        accessToken: 'test-access-token'
      },
      store: new RoomStore(storePath),
      v2Store,
      heartbeatIntervalMs: 50,
      preJoinTimeoutMs: 400,
      relayV2: {
        channelInviteTtlMs: 1_000,
        resumeTokenTtlMs: 5_000,
        mobileReconnectGraceMs: 70,
        serverCaSha256: 'ca-sha',
        serverCaDerB64: 'ca-der'
      }
    })
  }

  async function startServer(): Promise<void> {
    await server.start()
    url = `ws://127.0.0.1:${server.resolvedPort}`
  }

  async function restartServer(): Promise<void> {
    for (const client of clients.splice(0)) {
      client.close()
    }
    await server.stop()
    server = createServer()
    await startServer()
  }

  async function connectPc(
    pcId: string,
    pcName: string,
    expectedMobile: Record<string, unknown> | null = null
  ): Promise<RelayTestClient> {
    const pc = newClient()
    await pc.open()
    pc.send(
      JSON.stringify({
        type: 'pc-hello',
        v: RELAY_V2_PROTOCOL_VERSION,
        pcId,
        pcName,
        pcSecret: `secret-${pcId}`,
        accessToken: 'test-access-token',
        publicKeyB64: `pub-${pcId}`
      })
    )
    const ack = await pc.nextJson()
    expect(ack).toMatchObject({
      type: 'pc-hello-ack',
      pcId,
      state: 'online'
    })
    if (expectedMobile) {
      expect(ack).toMatchObject({ mobile: expectedMobile })
    } else {
      expect(ack).toMatchObject({ mobile: null })
    }
    return pc
  }

  async function createChannel(
    pc: RelayTestClient,
    mode: 'keep-existing' | 'disconnect-existing'
  ): Promise<ChannelCreated> {
    pc.send(JSON.stringify({ type: 'channel-create', mode }))
    const message = (await pc.nextJson()) as ChannelCreated
    expect(message).toMatchObject({ type: 'channel-created' })
    return message
  }

  async function joinMobile(
    channel: ChannelCreated,
    mobileDeviceId: string,
    mobileName: string
  ): Promise<{ mobile: RelayTestClient; ack: MobileBindAck }> {
    const mobile = newClient()
    await mobile.open()
    mobile.send(
      JSON.stringify({
        type: 'mobile-join',
        v: RELAY_V2_PROTOCOL_VERSION,
        channelId: channel.channelId,
        inviteToken: channel.inviteToken,
        mobileDeviceId,
        mobileName
      })
    )
    const ack = (await mobile.nextJson()) as MobileBindAck
    expect(ack).toMatchObject({
      type: 'mobile-bind-ack',
      pcId: channel.qrPayload.pcId,
      mobileDeviceId
    })
    return { mobile, ack }
  }

  async function resumeMobile(
    pcId: string,
    mobileDeviceId: string,
    resumeToken: string
  ): Promise<RelayTestClient> {
    const mobile = newClient()
    await mobile.open()
    mobile.send(
      JSON.stringify({
        type: 'mobile-resume',
        v: RELAY_V2_PROTOCOL_VERSION,
        pcId,
        mobileDeviceId,
        resumeToken
      })
    )
    return mobile
  }

  function newClient(): RelayTestClient {
    const client = new RelayTestClient(url)
    clients.push(client)
    return client
  }
})
