import type { IDisposable } from '@xterm/xterm'
import {
  DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES,
  type MacNativeTextInputSourceFeatures
} from './terminal-ime-input-source'
import {
  isImeNativeTextKeydownCandidate,
  isSinglePrintableTextKey,
  type ImeNativeTextKeyEvent
} from './terminal-ime-native-text-candidates'
import {
  logNativeForwarderCancel,
  logNativeForwarderClaimedKeydown,
  logNativeForwarderInput,
  logNativeForwarderKeydown,
  logNativeForwarderPendingTimeout,
  logNativeForwarderRejected,
  shouldLogNativeTextKeyEvent
} from './terminal-ime-native-forwarder-diagnostics'

export { isImeNativeTextKeydownCandidate } from './terminal-ime-native-text-candidates'
export type { ImeNativeTextKeyEvent } from './terminal-ime-native-text-candidates'

// Why: some macOS input sources and synthetic Unicode injectors commit native
// text through a plain `insertText` event after a printable keydown. Xterm's
// kitty keyboard protocol can encode and cancel that keydown before Chromium
// commits the real text, so this narrowly bypasses known native-text candidates
// and forwards the committed glyph from the input event straight to the PTY.

type ClaimedKeyPress = {
  key: string
  code?: string
}

export type TerminalImeNativeTextForwarder = IDisposable & {
  /**
   * Returns true when this keyboard event belongs to a direct native text
   * commit and should bypass xterm (the caller should return `false` from
   * `attachCustomKeyEventHandler`). The committed glyph is forwarded later from
   * the `input` event via the `sendInput` dependency.
   */
  claimKeyEvent: (event: ImeNativeTextKeyEvent) => boolean
}

function matchesClaimedPress(event: ImeNativeTextKeyEvent, claimedPress: ClaimedKeyPress): boolean {
  if (event.code && claimedPress.code) {
    return event.code === claimedPress.code
  }
  return event.key === claimedPress.key
}

function matchesClaimedKeypress(
  event: ImeNativeTextKeyEvent,
  claimedPress: ClaimedKeyPress
): boolean {
  if (matchesClaimedPress(event, claimedPress)) {
    return true
  }
  if (event.code && claimedPress.code) {
    return false
  }
  // Why: IME/native-text keypresses can carry the transformed glyph and omit
  // physical `code`; keep xterm silent until the input event forwards the text.
  return isSinglePrintableTextKey(event.key)
}

export function installTerminalImeNativeTextForwarder(args: {
  terminalElement: HTMLElement | null | undefined
  isComposing: () => boolean
  sendInput: (data: string) => void
  getInputSourceFeatures?: () => MacNativeTextInputSourceFeatures
}): TerminalImeNativeTextForwarder {
  if (!args.terminalElement) {
    return {
      claimKeyEvent: () => false,
      dispose: () => undefined
    }
  }

  const terminalElement = args.terminalElement
  let pendingForward = false
  let pendingForwardClearTimer: number | null = null
  let claimedPress: ClaimedKeyPress | null = null

  const clearPendingForwardTimer = (): void => {
    if (pendingForwardClearTimer !== null) {
      window.clearTimeout(pendingForwardClearTimer)
      pendingForwardClearTimer = null
    }
  }

  const disarmPendingForward = (): void => {
    clearPendingForwardTimer()
    pendingForward = false
  }

  const schedulePendingForwardClear = (): void => {
    clearPendingForwardTimer()
    // Why: some macOS IMEs deliver keyup before the final insertText event;
    // keep the native commit armed briefly, then drop genuinely stray inserts.
    pendingForwardClearTimer = window.setTimeout(() => {
      pendingForward = false
      pendingForwardClearTimer = null
      logNativeForwarderPendingTimeout(claimedPress, terminalElement)
    }, 100)
  }

  const claimKeyEvent = (event: ImeNativeTextKeyEvent): boolean => {
    if (event.type === 'keydown') {
      const compositionActive = args.isComposing()
      const features =
        args.getInputSourceFeatures?.() ?? DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES
      const candidate = isImeNativeTextKeydownCandidate(event, compositionActive, features)
      if (shouldLogNativeTextKeyEvent(event, candidate, features)) {
        logNativeForwarderKeydown({
          event,
          compositionActive,
          features,
          candidate,
          pendingForward,
          claimedPress,
          terminalElement
        })
      }
      if (!candidate) {
        return false
      }
      // Arm forwarding so the upcoming input event is sent to the PTY.
      clearPendingForwardTimer()
      pendingForward = true
      claimedPress = { key: event.key, code: event.code }
      logNativeForwarderClaimedKeydown(event, features, claimedPress, terminalElement)
      return true
    }
    if (!claimedPress) {
      return false
    }
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing === true) {
      logNativeForwarderRejected('native-forwarder-rejected-modifier-or-composing', {
        event,
        pendingForward,
        claimedPress,
        terminalElement
      })
      return false
    }
    if (event.type === 'keyup') {
      if (!matchesClaimedPress(event, claimedPress)) {
        logNativeForwarderRejected('native-forwarder-keyup-mismatch', {
          event,
          pendingForward,
          claimedPress,
          terminalElement
        })
        return false
      }
      claimedPress = null
      if (pendingForward) {
        schedulePendingForwardClear()
      }
      // Bypass so the kitty release sequence for the swallowed press cannot leak.
      logNativeForwarderRejected('native-forwarder-claimed-keyup', {
        event,
        pendingForward,
        claimedPress,
        terminalElement
      })
      return true
    }
    if (event.type === 'keypress') {
      // Keep the keydown's armed state but still bypass xterm so it does not
      // double-send printable text before our input forward runs.
      const matches = matchesClaimedKeypress(event, claimedPress)
      logNativeForwarderRejected(
        'native-forwarder-keypress',
        {
          event,
          pendingForward,
          claimedPress,
          terminalElement
        },
        {
          matches
        }
      )
      return matches
    }
    return false
  }

  const forwardCommittedText = (event: Event): void => {
    if (!(event instanceof InputEvent)) {
      return
    }
    if (!pendingForward) {
      return
    }
    if (event.inputType !== 'insertText') {
      logNativeForwarderInput('native-forwarder-disarm-non-insert-text', event, claimedPress)
      disarmPendingForward()
      return
    }
    disarmPendingForward()
    logNativeForwarderInput('native-forwarder-forward-insert-text', event, claimedPress)
    if (event.data) {
      args.sendInput(event.data)
    }
    event.stopImmediatePropagation()
    // The glyph only landed in xterm's helper textarea because we let the
    // keydown reach the native pipeline; clear it back to its empty resting
    // state so it cannot accumulate across keystrokes.
    if (event.target instanceof HTMLTextAreaElement) {
      event.target.value = ''
    }
  }

  const cancelPending = (reason: string): void => {
    logNativeForwarderCancel(reason, pendingForward, claimedPress, terminalElement)
    disarmPendingForward()
    claimedPress = null
  }

  terminalElement.addEventListener('input', forwardCommittedText, true)
  const cancelPendingOnBlur = (): void => cancelPending('blur')
  terminalElement.addEventListener('blur', cancelPendingOnBlur, true)

  return {
    claimKeyEvent,
    dispose: () => {
      cancelPending('dispose')
      terminalElement.removeEventListener('input', forwardCommittedText, true)
      terminalElement.removeEventListener('blur', cancelPendingOnBlur, true)
    }
  }
}
