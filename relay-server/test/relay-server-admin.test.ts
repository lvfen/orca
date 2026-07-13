import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RelayCertificateDiscovery } from '../src/certificate-discovery.js'
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
  qrPayload: { pcId: string }
}

describe('RelayServer admin and certificate discovery', () => {
  let dir: string
  let server: RelayServer
  let url: string
  let httpUrl: string
  const clients: RelayTestClient[] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-admin-'))
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close()
    }
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  it('hides admin API unless a bearer token is configured', async () => {
    await startServer()

    const response = await fetch(`${httpUrl}/admin/connections`)

    expect(response.status).toBe(404)
  })

  it('authenticates admin requests and returns a sanitized v2 connection snapshot', async () => {
    await startServer({ adminToken: 'admin-secret' })
    const pc = await connectPc()
    const channel = await createChannel(pc)
    await joinMobile(channel)
    await pc.nextJson()

    const rejected = await fetch(`${httpUrl}/admin/connections`, {
      headers: { authorization: 'Bearer wrong' }
    })
    expect(rejected.status).toBe(403)

    const response = await adminFetch('/admin/connections')
    expect(response.status).toBe(200)
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(body).toMatchObject({
      pcs: [
        {
          pcId: 'pc_1',
          pcName: 'MacBook Pro',
          state: 'online',
          mobileDeviceId: 'mobile_1',
          mobileName: 'iPhone',
          mobileState: 'connected'
        }
      ],
      channels: [{ channelId: channel.channelId, pcId: 'pc_1', state: 'active' }],
      mobiles: [{ mobileDeviceId: 'mobile_1', pcId: 'pc_1', state: 'connected' }]
    })
    expect(body.pcs[0].remoteAddress).toEqual(expect.any(String))
    expect(serialized).not.toContain('pcSecretHash')
    expect(serialized).not.toContain('inviteTokenHash')
    expect(serialized).not.toContain('resumeTokenHash')
  })

  it('revokes a mobile binding through admin API and closes the live mobile socket', async () => {
    await startServer({ adminToken: 'admin-secret' })
    const pc = await connectPc()
    const channel = await createChannel(pc)
    const mobile = await joinMobile(channel)
    await pc.nextJson()

    const response = await adminFetch('/admin/mobiles/mobile_1/revoke', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(await pc.nextJson()).toMatchObject({
      type: 'mobile-state',
      state: 'revoked',
      mobileDeviceId: 'mobile_1'
    })
    expect((await mobile.waitClose()).code).toBe(RelayCloseCode.Unauthorized)
  })

  it('serves certificate discovery material when configured', async () => {
    const caCertDer = Buffer.from([1, 2, 3, 4])
    const caMobileConfig = '<plist><dict/></plist>'
    await startServer({
      certificateDiscovery: {
        caCertDer,
        caMobileConfig,
        certificateToken: 'orca-cert_test',
        caSha256B64: 'sha'
      }
    })

    const cert = await fetch(`${httpUrl}/.well-known/orca-relay/ca.cer`)
    const mobileConfig = await fetch(`${httpUrl}/.well-known/orca-relay/ca.mobileconfig`)
    const token = await fetch(`${httpUrl}/.well-known/orca-relay/cert-token`)

    expect(cert.status).toBe(200)
    expect(Buffer.from(await cert.arrayBuffer())).toEqual(caCertDer)
    expect(cert.headers.get('content-type')).toContain('application/pkix-cert')
    expect(await mobileConfig.text()).toBe(caMobileConfig)
    expect(await token.text()).toBe('orca-cert_test\n')
  })

  async function startServer(
    config: {
      adminToken?: string
      certificateDiscovery?: RelayCertificateDiscovery
    } = {}
  ): Promise<void> {
    const storePath = join(dir, 'rooms.json')
    const v2Store = new RelayV2Store(join(dir, 'relay-v2.json'))
    server = new RelayServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        publicUrl: 'wss://relay.example.test',
        storePath,
        v2StorePath: join(dir, 'relay-v2.json'),
        ...(config.adminToken ? { adminToken: config.adminToken } : {}),
        ...(config.certificateDiscovery
          ? { certificateDiscovery: config.certificateDiscovery }
          : {})
      },
      store: new RoomStore(storePath),
      v2Store,
      heartbeatIntervalMs: 50,
      preJoinTimeoutMs: 400
    })
    await server.start()
    url = `ws://127.0.0.1:${server.resolvedPort}`
    httpUrl = `http://127.0.0.1:${server.resolvedPort}`
  }

  async function connectPc(): Promise<RelayTestClient> {
    const pc = newClient()
    await pc.open()
    pc.send(
      JSON.stringify({
        type: 'pc-hello',
        v: RELAY_V2_PROTOCOL_VERSION,
        pcId: 'pc_1',
        pcName: 'MacBook Pro',
        pcSecret: 'pc-secret',
        publicKeyB64: 'pc-public-key'
      })
    )
    expect(await pc.nextJson()).toMatchObject({ type: 'pc-hello-ack', pcId: 'pc_1' })
    return pc
  }

  async function createChannel(pc: RelayTestClient): Promise<ChannelCreated> {
    pc.send(JSON.stringify({ type: 'channel-create', mode: 'disconnect-existing' }))
    const message = (await pc.nextJson()) as ChannelCreated
    expect(message.type).toBe('channel-created')
    return message
  }

  async function joinMobile(channel: ChannelCreated): Promise<RelayTestClient> {
    const mobile = newClient()
    await mobile.open()
    mobile.send(
      JSON.stringify({
        type: 'mobile-join',
        v: RELAY_V2_PROTOCOL_VERSION,
        channelId: channel.channelId,
        inviteToken: channel.inviteToken,
        mobileDeviceId: 'mobile_1',
        mobileName: 'iPhone'
      })
    )
    expect(await mobile.nextJson()).toMatchObject({
      type: 'mobile-bind-ack',
      pcId: channel.qrPayload.pcId,
      mobileDeviceId: 'mobile_1'
    })
    return mobile
  }

  function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', 'Bearer admin-secret')
    return fetch(`${httpUrl}${path}`, { ...init, headers })
  }

  function newClient(): RelayTestClient {
    const client = new RelayTestClient(url)
    clients.push(client)
    return client
  }
})
