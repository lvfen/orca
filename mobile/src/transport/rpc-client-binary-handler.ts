import {
  decodeBrowserScreencastFrame,
  type BrowserScreencastFrame
} from './browser-screencast-protocol'
import {
  handleTerminalBinaryFrame,
  type TerminalSnapshotState
} from './rpc-client-terminal-binary-frame'

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
    handleTerminalBinaryFrame(bytes, {
      terminalSnapshots,
      getListener: (streamId) => terminalStreamListeners.get(streamId),
      recordValidatedInboundTraffic
    })
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
