import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lookupToken, RoomStore } from '../src/room-store.js'

describe('RoomStore', () => {
  let dir: string
  let storePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-store-'))
    storePath = join(dir, 'rooms.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates and persists a token pair', () => {
    const store = new RoomStore(storePath)
    const room = store.createPair('wss://relay.example.com', 'my-mac')
    expect(room.pcToken.startsWith('orca-pc_')).toBe(true)
    expect(room.mobileToken.startsWith('orca-mb_')).toBe(true)

    const reloaded = new RoomStore(storePath)
    expect(reloaded.get(room.roomId)?.pcToken).toBe(room.pcToken)
    expect(reloaded.list()).toHaveLength(1)
  })

  it('writes the store file owner-only on POSIX', () => {
    if (process.platform === 'win32') {
      return
    }
    const store = new RoomStore(storePath)
    store.createPair('wss://relay.example.com', 'my-mac')
    const mode = statSync(storePath).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('looks up a token to its room and slot', () => {
    const store = new RoomStore(storePath)
    const room = store.createPair('wss://relay.example.com', 'my-mac')

    const pc = lookupToken(store, room.pcToken)
    expect(pc?.lookup.role).toBe('host')
    expect(pc?.lookup.room.roomId).toBe(room.roomId)
    expect(pc?.expected).toBe(room.pcToken)

    const mb = lookupToken(store, room.mobileToken)
    expect(mb?.lookup.role).toBe('client')
    expect(mb?.expected).toBe(room.mobileToken)
  })

  it('returns null for an unknown or malformed token', () => {
    const store = new RoomStore(storePath)
    store.createPair('wss://relay.example.com', 'my-mac')
    expect(lookupToken(store, 'orca-pc_bogus')).toBeNull()
    expect(lookupToken(store, 'garbage')).toBeNull()
  })

  it('revokes a room so its tokens no longer resolve', () => {
    const store = new RoomStore(storePath)
    const room = store.createPair('wss://relay.example.com', 'my-mac')
    expect(store.revoke(room.roomId)).toBe(true)
    expect(store.get(room.roomId)).toBeNull()
    expect(lookupToken(store, room.pcToken)).toBeNull()
    expect(store.revoke(room.roomId)).toBe(false)
  })

  it('keeps multiple independent rooms', () => {
    const store = new RoomStore(storePath)
    const a = store.createPair('wss://relay.example.com', 'mac-a')
    const b = store.createPair('wss://relay.example.com', 'mac-b')
    expect(a.roomId).not.toBe(b.roomId)
    expect(store.list()).toHaveLength(2)
    store.revoke(a.roomId)
    expect(store.list()).toHaveLength(1)
    expect(store.get(b.roomId)).not.toBeNull()
  })
})
