import { type RawData, WebSocket } from 'ws'
import { RelayCloseCode } from '../protocol.js'
import { rawDataToString } from '../raw-data.js'
import type { ChannelCreateMessage, RelayV2ServerMessage } from './relay-v2-protocol.js'
import { encodeRelayV2ServerMessage } from './relay-v2-protocol.js'
import type { RelayV2LivePc } from './relay-v2-admin-store.js'

export type RelayV2SocketState =
  | {
      kind: 'v2'
      role: 'pc'
      pcId: string
      channelId: string | null
      connectedAt: number
      remoteAddress?: string
    }
  | {
      kind: 'v2'
      role: 'mobile'
      pcId: string
      mobileDeviceId: string
      channelId: string
      connectedAt: number
      remoteAddress?: string
    }

export type RelayV2PcSlot = {
  ws: WebSocket
  state: Extract<RelayV2SocketState, { role: 'pc' }>
}

export type RelayV2MobileSlot = {
  ws: WebSocket
  state: Extract<RelayV2SocketState, { role: 'mobile' }>
}

export type ReleasedRelayV2Pc = {
  released: boolean
  orphanedMobiles: RelayV2MobileSlot[]
}

type ChannelSlot = {
  pc: RelayV2PcSlot | null
  mobile: RelayV2MobileSlot | null
}

export class RelayV2SocketRegistry {
  private readonly pcSockets = new Map<string, RelayV2PcSlot>()
  private readonly mobileSockets = new Map<string, RelayV2MobileSlot>()
  private readonly channelSockets = new Map<string, ChannelSlot>()

  pc(pcId: string): RelayV2PcSlot | null {
    return this.pcSockets.get(pcId) ?? null
  }

  livePcs(): RelayV2LivePc[] {
    return [...this.pcSockets.values()].map((slot) => {
      const summary: RelayV2LivePc = { pcId: slot.state.pcId }
      if (slot.state.remoteAddress) {
        summary.remoteAddress = slot.state.remoteAddress
      }
      return summary
    })
  }

  bindPc(ws: WebSocket, state: Extract<RelayV2SocketState, { role: 'pc' }>): RelayV2PcSlot {
    const existing = this.pcSockets.get(state.pcId)
    if (existing && existing.ws !== ws) {
      closeWithCode(existing.ws, RelayCloseCode.Occupied, 'occupied')
    }
    const slot = { ws, state }
    this.pcSockets.set(state.pcId, slot)
    if (state.channelId) {
      this.ensureChannelSlot(state.channelId).pc = slot
    }
    return slot
  }

  bindMobile(
    ws: WebSocket,
    state: Extract<RelayV2SocketState, { role: 'mobile' }>
  ): RelayV2MobileSlot {
    const existing = this.mobileSockets.get(state.mobileDeviceId)
    if (existing && existing.ws !== ws) {
      this.detachMobileFromChannel(existing.state.channelId, existing.ws)
      closeWithCode(existing.ws, RelayCloseCode.Occupied, 'occupied')
    }
    const slot = { ws, state }
    this.mobileSockets.set(state.mobileDeviceId, slot)
    this.ensureChannelSlot(state.channelId).mobile = slot
    return slot
  }

  attachPcToChannel(channelId: string, slot: RelayV2PcSlot | null): void {
    this.ensureChannelSlot(channelId).pc = slot
  }

  attachMobileToChannel(channelId: string, slot: RelayV2MobileSlot | null): void {
    this.ensureChannelSlot(channelId).mobile = slot
  }

  forward(ws: WebSocket, state: RelayV2SocketState, data: RawData, isBinary: boolean): void {
    const channelId = state.channelId
    if (!channelId) {
      return
    }
    const slot = this.channelSockets.get(channelId)
    const target = state.role === 'pc' ? slot?.mobile : slot?.pc
    if (target && target.ws !== ws && target.ws.readyState === WebSocket.OPEN) {
      target.ws.send(data, { binary: isBinary })
    }
  }

  releasePc(state: Extract<RelayV2SocketState, { role: 'pc' }>, ws: WebSocket): ReleasedRelayV2Pc {
    const slot = this.pcSockets.get(state.pcId)
    if (!slot || slot.ws !== ws) {
      return { released: false, orphanedMobiles: [] }
    }
    this.pcSockets.delete(state.pcId)
    const orphanedMobiles: RelayV2MobileSlot[] = []
    for (const [channelId, channelSlot] of this.channelSockets.entries()) {
      if (channelSlot.pc?.ws !== ws) {
        continue
      }
      channelSlot.pc = null
      if (channelSlot.mobile) {
        orphanedMobiles.push(channelSlot.mobile)
        this.mobileSockets.delete(channelSlot.mobile.state.mobileDeviceId)
        channelSlot.mobile = null
      }
      this.deleteChannelIfEmpty(channelId)
    }
    return { released: true, orphanedMobiles }
  }

  releaseMobile(state: Extract<RelayV2SocketState, { role: 'mobile' }>, ws: WebSocket): boolean {
    const slot = this.mobileSockets.get(state.mobileDeviceId)
    if (!slot || slot.ws !== ws) {
      return false
    }
    this.mobileSockets.delete(state.mobileDeviceId)
    this.detachMobileFromChannel(state.channelId, ws)
    return true
  }

  removeMobile(mobileDeviceId: string): RelayV2MobileSlot | null {
    const slot = this.mobileSockets.get(mobileDeviceId)
    if (!slot) {
      return null
    }
    this.mobileSockets.delete(mobileDeviceId)
    this.detachMobileFromChannel(slot.state.channelId, slot.ws)
    return slot
  }

  clear(): void {
    this.pcSockets.clear()
    this.mobileSockets.clear()
    this.channelSockets.clear()
  }

  private detachMobileFromChannel(channelId: string, ws: WebSocket): void {
    const slot = this.channelSockets.get(channelId)
    if (slot?.mobile?.ws === ws) {
      slot.mobile = null
      this.deleteChannelIfEmpty(channelId)
    }
  }

  private ensureChannelSlot(channelId: string): ChannelSlot {
    const existing = this.channelSockets.get(channelId)
    if (existing) {
      return existing
    }
    const slot: ChannelSlot = { pc: null, mobile: null }
    this.channelSockets.set(channelId, slot)
    return slot
  }

  private deleteChannelIfEmpty(channelId: string): void {
    const slot = this.channelSockets.get(channelId)
    if (slot && !slot.pc && !slot.mobile) {
      this.channelSockets.delete(channelId)
    }
  }
}

export function parsePcControlFrame(raw: string): ChannelCreateMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === 'channel-create' &&
    ((parsed as { mode?: unknown }).mode === 'keep-existing' ||
      (parsed as { mode?: unknown }).mode === 'disconnect-existing')
  ) {
    return {
      type: 'channel-create',
      mode: (parsed as { mode: 'keep-existing' | 'disconnect-existing' }).mode
    }
  }
  return null
}

export function sendRelayV2(ws: WebSocket, message: RelayV2ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeRelayV2ServerMessage(message))
  }
}

export function closeWithCode(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason)
  } catch {
    // Socket may already be closing; terminate fallback is best effort.
  }
  const timer = setTimeout(() => {
    try {
      ws.terminate()
    } catch {
      // terminate() is idempotent best-effort.
    }
  }, 1_000)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

export function parseRelayV2Text(data: RawData): string {
  return rawDataToString(data)
}
