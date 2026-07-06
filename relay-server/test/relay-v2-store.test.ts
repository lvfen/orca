import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RelayV2Store } from '../src/v2/relay-v2-store.js'

describe('RelayV2Store', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-v2-store-'))
    storePath = join(dir, 'relay-v2.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates and authenticates a PC without persisting the clear secret', () => {
    const store = new RelayV2Store(storePath)
    const pc = store.upsertPc({
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'pc-secret',
      publicKeyB64: 'pub',
      relayUrl: 'wss://relay.example.com',
      now: 100
    })

    expect(pc).toMatchObject({
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      state: 'online',
      createdAt: 100,
      lastSeenAt: 100
    })
    expect(store.verifyPcSecret('pc_1', 'pc-secret')).toBe(true)
    expect(store.verifyPcSecret('pc_1', 'wrong')).toBe(false)
    expect(readFileSync(storePath, 'utf8')).not.toContain('pc-secret')
  })

  it('writes the v2 store file owner-only on POSIX', () => {
    if (process.platform === 'win32') {
      return
    }
    const store = new RelayV2Store(storePath)
    store.upsertPc({
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'pc-secret',
      publicKeyB64: 'pub',
      relayUrl: 'wss://relay.example.com'
    })

    expect(statSync(storePath).mode & 0o777).toBe(0o600)
  })

  it('creates channels, stores only invite hashes, and expires stale pending channels', () => {
    const store = new RelayV2Store(storePath)
    store.upsertPc({
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'pc-secret',
      publicKeyB64: 'pub',
      relayUrl: 'wss://relay.example.com',
      now: 100
    })

    const created = store.createChannel('pc_1', 50, 100)

    expect(created).not.toBeNull()
    expect(created?.channel).toMatchObject({
      pcId: 'pc_1',
      state: 'pending',
      createdAt: 100,
      expiresAt: 150
    })
    expect(store.getPc('pc_1')?.activeChannelId).toBe(created?.channel.channelId)
    expect(store.verifyInviteToken(created!.channel.channelId, created!.inviteToken, 120)).toBe(
      true
    )
    expect(readFileSync(storePath, 'utf8')).not.toContain(created!.inviteToken)

    expect(store.expireStaleChannels(151)).toBe(1)
    expect(store.getChannel(created!.channel.channelId)?.state).toBe('expired')
    expect(store.verifyInviteToken(created!.channel.channelId, created!.inviteToken, 151)).toBe(
      false
    )
  })

  it('binds a mobile to a channel and verifies resume tokens', () => {
    const store = new RelayV2Store(storePath)
    store.upsertPc({
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'pc-secret',
      publicKeyB64: 'pub',
      relayUrl: 'wss://relay.example.com',
      now: 100
    })
    const created = store.createChannel('pc_1', 500, 100)
    const bound = store.bindMobileToChannel({
      channelId: created!.channel.channelId,
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone',
      resumeTokenTtlMs: 1000,
      now: 120
    })

    expect(bound).not.toBeNull()
    expect(bound?.binding).toMatchObject({
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone',
      pcId: 'pc_1',
      state: 'connected',
      connectedAt: 120,
      disconnectedAt: null,
      resumeTokenExpiresAt: 1120
    })
    expect(store.getChannel(created!.channel.channelId)?.state).toBe('active')
    expect(store.getChannel(created!.channel.channelId)?.mobileDeviceId).toBe('mobile_1')
    expect(store.verifyResumeToken('pc_1', 'mobile_1', bound!.resumeToken, 500)).toBe(true)
    expect(store.verifyResumeToken('pc_1', 'mobile_1', bound!.resumeToken, 1121)).toBe(false)
    expect(readFileSync(storePath, 'utf8')).not.toContain(bound!.resumeToken)
  })

  it('updates mobile connection states and supports revocation', () => {
    const store = createStoreWithBoundMobile(storePath)

    expect(store.setMobileState('mobile_1', 'reconnecting', 200)).toMatchObject({
      state: 'reconnecting',
      disconnectedAt: 200,
      lastSeenAt: 200
    })
    expect(store.setMobileState('mobile_1', 'offline', 300)).toMatchObject({
      state: 'offline',
      disconnectedAt: 300,
      lastSeenAt: 300
    })
    expect(store.revokeMobileBinding('mobile_1', 400)).toMatchObject({
      state: 'revoked',
      disconnectedAt: 400,
      lastSeenAt: 400
    })
  })

  it('normalizes malformed store files without throwing', () => {
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        pcs: [{ pcId: 'pc_1' }],
        channels: [{ channelId: 'ch_1' }],
        mobileBindings: [{ mobileDeviceId: 'mobile_1' }]
      })
    )

    expect(new RelayV2Store(storePath).snapshot()).toEqual({
      version: 1,
      pcs: [],
      channels: [],
      mobileBindings: []
    })
  })
})

function createStoreWithBoundMobile(storePath: string): RelayV2Store {
  const store = new RelayV2Store(storePath)
  store.upsertPc({
    pcId: 'pc_1',
    pcName: 'MacBook Pro',
    pcSecret: 'pc-secret',
    publicKeyB64: 'pub',
    relayUrl: 'wss://relay.example.com',
    now: 100
  })
  const created = store.createChannel('pc_1', 500, 100)
  store.bindMobileToChannel({
    channelId: created!.channel.channelId,
    mobileDeviceId: 'mobile_1',
    mobileName: 'iPhone',
    resumeTokenTtlMs: 1000,
    now: 120
  })
  return store
}
