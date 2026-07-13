// Why: extracted from rpc-client.ts to keep that module under its line budget.
// These are the pure frame-decoding helpers — binary terminal-stream dispatch
// and streaming-result type guards — none of which touch the connection's
// mutable closure state directly.
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText
} from './terminal-stream-protocol'

export type TerminalStreamListener = (result: unknown) => void

export type TerminalSnapshotState = {
  streamId: number
  meta: Record<string, unknown>
  chunks: string[]
}

export function dispatchTerminalBinaryFrame(
  bytes: Uint8Array,
  terminalStreamListeners: Map<number, TerminalStreamListener>,
  terminalSnapshots: Map<number, TerminalSnapshotState>,
  recordValidatedInboundTraffic: () => void = () => {}
): void {
  const frame = decodeTerminalStreamFrame(bytes)
  if (!frame) {
    return
  }
  const listener = terminalStreamListeners.get(frame.streamId)
  if (!listener) {
    recordValidatedInboundTraffic()
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Output) {
    recordValidatedInboundTraffic()
    listener({
      type: 'data',
      streamId: frame.streamId,
      chunk: decodeTerminalStreamText(frame.payload)
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotStart) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    recordValidatedInboundTraffic()
    terminalSnapshots.set(frame.streamId, { streamId: frame.streamId, meta, chunks: [] })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotChunk) {
    recordValidatedInboundTraffic()
    const snapshot = terminalSnapshots.get(frame.streamId)
    if (!snapshot) {
      return
    }
    snapshot.chunks.push(decodeTerminalStreamText(frame.payload))
    return
  }
  if (frame.opcode === TerminalStreamOpcode.SnapshotEnd) {
    recordValidatedInboundTraffic()
    const snapshot = terminalSnapshots.get(frame.streamId)
    if (!snapshot) {
      return
    }
    terminalSnapshots.delete(frame.streamId)
    const kind = snapshot.meta.kind === 'resized' ? 'resized' : 'scrollback'
    listener({
      ...snapshot.meta,
      type: kind,
      streamId: frame.streamId,
      serialized: snapshot.chunks.join('')
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Resized) {
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(frame.payload)
    if (!meta) {
      return
    }
    recordValidatedInboundTraffic()
    listener({
      ...meta,
      type: 'resized',
      streamId: frame.streamId
    })
    return
  }
  if (frame.opcode === TerminalStreamOpcode.Error) {
    recordValidatedInboundTraffic()
    listener({
      type: 'error',
      streamId: frame.streamId,
      message: decodeTerminalStreamText(frame.payload)
    })
  }
}

export function isTerminalSubscribedResult(
  value: unknown
): value is { type: 'subscribed'; streamId: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'subscribed' &&
    typeof (value as { streamId?: unknown }).streamId === 'number'
  )
}

export function isBrowserScreencastReadyResult(
  value: unknown
): value is { type: 'ready'; subscriptionId: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'ready' &&
    typeof (value as { subscriptionId?: unknown }).subscriptionId === 'string'
  )
}
