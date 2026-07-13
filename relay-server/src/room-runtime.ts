import type { RawData, WebSocket } from 'ws'
import {
  encodeControlFrame,
  RelayCloseCode,
  type RelayControlFrame,
  type RelayRole
} from './protocol.js'

type Slot = { ws: WebSocket }

type LiveRoom = {
  host: Slot | null
  client: Slot | null
}

// Why: a superseded/recycled peer is closed with a reason code (so it knows
// whether to reconnect), but a half-open socket may never complete the close
// handshake. Fall back to terminate() shortly after so the socket is reaped and
// cannot linger. We detach the slot BEFORE closing, so the slot is free
// immediately regardless of how long teardown takes.
const CLOSE_TERMINATE_FALLBACK_MS = 1_000

// Why: observability hook so the server can count supersede/recycle events for
// /healthz without the hub depending on the metrics module.
export type RoomLifecycleEvent = 'superseded' | 'peer-recycled'

// Why: holds the live host/client sockets per room and enforces the two 1:1
// invariants from the design doc — supersede (a new socket evicts the old in
// its slot) and lifecycle coupling (a genuine drop of one slot recycles the
// other). All multi-device / multiplexing is intentionally absent: one room is
// a single direct pipe.
export class RoomHub {
  private readonly rooms = new Map<string, LiveRoom>()

  constructor(private readonly onLifecycle?: (event: RoomLifecycleEvent) => void) {}

  bind(roomId: string, role: RelayRole, ws: WebSocket): void {
    const room = this.ensureRoom(roomId)
    const existing = room[role]
    if (existing && existing.ws !== ws) {
      // Supersede: a reconnecting PC/phone (or an external takeover with the
      // same token) evicts whoever held the slot. This is NOT a peer-recycle,
      // so the paired socket is left untouched and re-paired to the new socket.
      this.onLifecycle?.('superseded')
      closeWithCode(existing.ws, RelayCloseCode.Occupied, 'occupied')
    }
    room[role] = { ws }

    if (role === 'host') {
      // Ack immediately so the desktop confirms its host slot is bound even
      // while no phone is online (the host socket "waits").
      send(ws, { type: 'host-join-ack' })
    }

    const { host, client } = room
    if (host && client) {
      send(client.ws, { type: 'room-ready' })
      send(host.ws, { type: 'peer-online' })
      return
    }
    if (role === 'client') {
      // Parked: keep the client socket but tell it the desktop is offline so
      // the phone UI can show "desktop not online". When a host later binds,
      // the host && client branch above promotes both to room-ready.
      send(ws, { type: 'host-offline' })
    }
  }

  // Why: once joined, every frame is opaque ciphertext forwarded verbatim to
  // the paired socket. The relay never parses the payload. Frames that arrive
  // before the pair exists (e.g. a parked client) are dropped — the protocol
  // never sends data before room-ready.
  forward(roomId: string, fromRole: RelayRole, data: RawData, isBinary: boolean): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    const target = fromRole === 'host' ? room.client : room.host
    if (target && target.ws.readyState === target.ws.OPEN) {
      target.ws.send(data, { binary: isBinary })
    }
  }

  // Why: called when `ws` genuinely closes. If it is no longer the current
  // occupant of its slot (it was superseded), this is a no-op — the slot
  // already points to the newer socket. If it IS the current occupant, clear
  // the slot and recycle the paired socket (lifecycle coupling). We clear both
  // slots before closing the pair so the pair's own close handler sees an empty
  // slot and does not recurse.
  release(roomId: string, role: RelayRole, ws: WebSocket): void {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    const slot = room[role]
    if (!slot || slot.ws !== ws) {
      return
    }
    room[role] = null
    const pairedRole: RelayRole = role === 'host' ? 'client' : 'host'
    const paired = room[pairedRole]
    if (paired) {
      room[pairedRole] = null
      this.onLifecycle?.('peer-recycled')
      closeWithCode(paired.ws, RelayCloseCode.PeerRecycled, 'peer-recycled')
    }
    if (!room.host && !room.client) {
      this.rooms.delete(roomId)
    }
  }

  // Test/observability helper: how many rooms currently hold at least one slot.
  get liveRoomCount(): number {
    return this.rooms.size
  }

  private ensureRoom(roomId: string): LiveRoom {
    const existing = this.rooms.get(roomId)
    if (existing) {
      return existing
    }
    const room: LiveRoom = { host: null, client: null }
    this.rooms.set(roomId, room)
    return room
  }
}

function send(ws: WebSocket, frame: RelayControlFrame): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(encodeControlFrame(frame))
  }
}

function closeWithCode(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason)
  } catch {
    // Why: close() can throw on a socket already mid-teardown; the fallback
    // terminate below still reaps it, so swallow.
  }
  const timer = setTimeout(() => {
    try {
      ws.terminate()
    } catch {
      // Why: terminate() is idempotent best-effort; ignore if already gone.
    }
  }, CLOSE_TERMINATE_FALLBACK_MS)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}
