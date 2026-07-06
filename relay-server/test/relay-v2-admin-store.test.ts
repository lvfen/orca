import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  disconnectRelayV2PcInStore,
  revokeRelayV2ChannelInStore,
  revokeRelayV2MobileInStore,
  snapshotRelayV2Connections
} from '../src/v2/relay-v2-admin-store.js'
import { RelayV2Store } from '../src/v2/relay-v2-store.js'

describe('relay v2 admin store', () => {
  let dir: string
  let store: RelayV2Store

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-v2-admin-store-'))
    store = new RelayV2Store(join(dir, 'relay-v2.json'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns sanitized connection snapshots without token hashes', () => {
    const { channelId } = createBoundMobile()

    const snapshot = snapshotRelayV2Connections(store, [
      { pcId: 'pc_1', remoteAddress: '203.0.113.2' }
    ])
    const serialized = JSON.stringify(snapshot)

    expect(snapshot).toMatchObject({
      pcs: [
        {
          pcId: 'pc_1',
          state: 'online',
          activeChannelId: channelId,
          remoteAddress: '203.0.113.2',
          mobileDeviceId: 'mobile_1',
          mobileState: 'connected'
        }
      ],
      channels: [{ channelId, state: 'active', mobileDeviceId: 'mobile_1' }],
      mobiles: [{ mobileDeviceId: 'mobile_1', state: 'connected' }]
    })
    expect(serialized).not.toContain('pcSecretHash')
    expect(serialized).not.toContain('inviteTokenHash')
    expect(serialized).not.toContain('resumeTokenHash')
  })

  it('disconnects PCs and revokes channels/mobiles in local store', () => {
    const { channelId } = createBoundMobile()

    expect(disconnectRelayV2PcInStore(store, 'pc_1')).toBe(true)
    expect(store.getPc('pc_1')?.state).toBe('offline')

    expect(revokeRelayV2ChannelInStore(store, channelId)).toBe(true)
    expect(store.getChannel(channelId)?.state).toBe('revoked')
    expect(store.getMobileBinding('mobile_1')?.state).toBe('revoked')
    expect(store.getPc('pc_1')?.activeChannelId).toBeNull()
  })

  it('revokes every active channel for a local mobile binding', () => {
    const { channelId } = createBoundMobile()

    expect(revokeRelayV2MobileInStore(store, 'mobile_1')).toBe(true)

    expect(store.getMobileBinding('mobile_1')?.state).toBe('revoked')
    expect(store.getChannel(channelId)?.state).toBe('revoked')
    expect(store.getPc('pc_1')?.activeChannelId).toBeNull()
  })

  function createBoundMobile(): { channelId: string } {
    store.upsertPc({
      pcId: 'pc_1',
      pcName: 'MacBook Pro',
      pcSecret: 'pc-secret',
      publicKeyB64: 'pub',
      relayUrl: 'wss://relay.example.test',
      now: 100
    })
    const created = store.createChannel('pc_1', 1_000, 100)
    if (!created) {
      throw new Error('Expected channel')
    }
    store.bindMobileToChannel({
      channelId: created.channel.channelId,
      mobileDeviceId: 'mobile_1',
      mobileName: 'iPhone',
      resumeTokenTtlMs: 5_000,
      now: 110
    })
    return { channelId: created.channel.channelId }
  }
})
