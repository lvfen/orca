import {
  encodeRelayV2MobileJoin,
  encodeRelayV2MobileResume,
  parseRelayV2ServerMessage,
  type RelayV2MobileBindAck,
  type RelayV2MobileJoin,
  type RelayV2MobileResume,
  type RelayV2MobileResumeAck
} from '../relay/relay-v2-invite'
import type { ConnectionLogLevel } from './types'

export type RelayV2ConnectOptions =
  | {
      mode: 'join'
      message: RelayV2MobileJoin
      onBindAck?: (ack: RelayV2MobileBindAck) => void
    }
  | {
      mode: 'resume'
      message: RelayV2MobileResume
      onResumeAck?: (ack: RelayV2MobileResumeAck) => void
    }

type RelayV2PreHandshakeOptions = {
  ws: WebSocket
  relayV2: RelayV2ConnectOptions
  timeoutMs: number
  emitLog: (level: ConnectionLogLevel, message: string, detail?: string) => void
  onTimeout: () => void
  beginE2EEHandshake: () => void
}

export type RelayV2PreHandshake = {
  clear: () => void
  handleText: (raw: string) => boolean
  isAwaiting: () => boolean
}

export function startRelayV2PreHandshake({
  ws,
  relayV2,
  timeoutMs,
  emitLog,
  onTimeout,
  beginE2EEHandshake
}: RelayV2PreHandshakeOptions): RelayV2PreHandshake {
  let awaiting = true
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null
    if (!awaiting) {
      return
    }
    emitLog('error', 'Relay v2 join timeout', `No relay v2 ack within ${timeoutMs / 1000}s`)
    onTimeout()
  }, timeoutMs)

  ws.send(
    relayV2.mode === 'join'
      ? encodeRelayV2MobileJoin(relayV2.message)
      : encodeRelayV2MobileResume(relayV2.message)
  )

  function clear(): void {
    awaiting = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function handleText(raw: string): boolean {
    const message = parseRelayV2ServerMessage(raw)
    if (message?.type === 'mobile-bind-ack' && relayV2.mode === 'join') {
      clear()
      relayV2.onBindAck?.(message)
      emitLog('success', 'Relay v2 channel bound', 'Starting E2EE handshake')
      beginE2EEHandshake()
      return true
    }
    if (message?.type === 'mobile-resume-ack' && relayV2.mode === 'resume') {
      clear()
      relayV2.onResumeAck?.(message)
      emitLog('success', 'Relay v2 channel resumed', 'Starting E2EE handshake')
      beginE2EEHandshake()
      return true
    }
    return false
  }

  return {
    clear,
    handleText,
    isAwaiting: () => awaiting
  }
}
