import { readSecureJson, writeSecureJson } from './secure-file.js'
import { decodeToken, generateRoomId, generateTokenPair, type TokenPair } from './token.js'

// Why: a room is the 1:1 binding of one PC token to one mobile token. The relay
// persists the matched pair so token auth survives a relay restart. The secret
// is embedded in the tokens themselves, so the store only needs the token
// strings to validate joins (constant-time compare in the server).
export type Room = {
  roomId: string
  name: string
  createdAt: number
  pcToken: string
  mobileToken: string
}

type StoreShape = {
  version: 1
  rooms: Room[]
}

const STORE_VERSION = 1

// Why: read-through on every access. The CLI (generate-pair/revoke) and the
// running server are separate processes; reloading the file before each lookup
// means a revoke takes effect for new joins without restarting the server.
export class RoomStore {
  constructor(private readonly storePath: string) {}

  private load(): StoreShape {
    const raw = readSecureJson<StoreShape>(this.storePath)
    if (!raw || raw.version !== STORE_VERSION || !Array.isArray(raw.rooms)) {
      return { version: STORE_VERSION, rooms: [] }
    }
    return raw
  }

  private persist(rooms: Room[]): void {
    writeSecureJson(this.storePath, { version: STORE_VERSION, rooms } satisfies StoreShape)
  }

  list(): Room[] {
    return this.load().rooms
  }

  get(roomId: string): Room | null {
    return this.load().rooms.find((room) => room.roomId === roomId) ?? null
  }

  // Why: deploy artifact. Generates a fresh roomId + secret-bearing token pair,
  // binds them under one room, and persists. The relayUrl is baked into the
  // tokens so the phone/desktop need no extra config.
  createPair(relayUrl: string, name: string): Room {
    const store = this.load()
    const roomId = generateRoomId()
    const pair: TokenPair = generateTokenPair(relayUrl, roomId)
    const room: Room = {
      roomId,
      name,
      createdAt: Date.now(),
      pcToken: pair.pcToken,
      mobileToken: pair.mobileToken
    }
    this.persist([...store.rooms, room])
    return room
  }

  // Why: rotating a pair (re-pair on the PC) is the only way to bind a
  // different phone or move to a new PC; it invalidates the previous tokens.
  revoke(roomId: string): boolean {
    const store = this.load()
    const next = store.rooms.filter((room) => room.roomId !== roomId)
    if (next.length === store.rooms.length) {
      return false
    }
    this.persist(next)
    return true
  }
}

export type TokenLookup = {
  room: Room
  role: 'host' | 'client'
}

// Why: validate a presented token to its room + slot. We decode the roomId out
// of the token to find the room, then compare the FULL token string against the
// stored value for that slot — decoding alone is not auth, the stored-string
// match is. Returns the expected stored token so the caller can timing-safe
// compare without re-reading the store.
export function lookupToken(
  store: RoomStore,
  token: string
): { lookup: TokenLookup; expected: string } | null {
  const decoded = decodeToken(token)
  if (!decoded) {
    return null
  }
  const room = store.get(decoded.payload.roomId)
  if (!room) {
    return null
  }
  const expected = decoded.role === 'host' ? room.pcToken : room.mobileToken
  return { lookup: { room, role: decoded.role }, expected }
}
