import {
  decodeBrowserScreencastFrame,
  type BrowserScreencastFrame
} from './browser-screencast-protocol'
import { dispatchTerminalBinaryFrame } from './rpc-client-frame-decoding'
import type { TerminalSnapshotState } from './rpc-client-frame-decoding'

type BrowserStream = {
  method: string
  cancelled?: boolean
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
}

export type RpcClientBinaryHandlerOptions = {
  streamListeners: Map<string, BrowserStream>
  terminalStreamListeners: Map<number, (result: unknown) => void>
  terminalSnapshots: Map<number, TerminalSnapshotState>
  getActiveBrowserScreencastRequestId: () => string | null
  recordValidatedInboundTraffic: () => void
}

export function createRpcClientBinaryHandler({
  streamListeners,
  terminalStreamListeners,
  terminalSnapshots,
  getActiveBrowserScreencastRequestId,
  recordValidatedInboundTraffic
}: RpcClientBinaryHandlerOptions): (bytes: Uint8Array) => void {
  return (bytes) => {
    const browserFrame = decodeBrowserScreencastFrame(bytes)
    if (browserFrame) {
      recordValidatedInboundTraffic()
      handleBrowserBinaryFrame(browserFrame)
      return
    }
    dispatchTerminalBinaryFrame(
      bytes,
      terminalStreamListeners,
      terminalSnapshots,
      recordValidatedInboundTraffic
    )
  }

  function handleBrowserBinaryFrame(frame: BrowserScreencastFrame): void {
    const activeRequestId = getActiveBrowserScreencastRequestId()
    if (!activeRequestId) {
      return
    }
    const stream = streamListeners.get(activeRequestId)
    if (!stream || stream.cancelled || stream.method !== 'browser.screencast') {
      return
    }
    stream.onBinaryFrame?.(frame)
  }
}
