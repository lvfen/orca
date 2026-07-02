import type { MacNativeTextInputSourceFeatures } from './terminal-ime-input-source'
import {
  logTerminalImeDiagnostic,
  summarizeElement,
  summarizeKeyboardEvent,
  summarizeTextInputEvent
} from '@/lib/terminal-ime-diagnostics'

type NativeTextKeyEvent = {
  type: string
  key: string
  code?: string
  keyCode?: number
  which?: number
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
}

type ClaimedPress = {
  key: string
  code?: string
} | null

type ForwarderLogContext = {
  event: NativeTextKeyEvent
  terminalElement: HTMLElement
  pendingForward: boolean
  claimedPress: ClaimedPress
}

export function shouldLogNativeTextKeyEvent(
  event: NativeTextKeyEvent,
  candidate: boolean,
  features: MacNativeTextInputSourceFeatures
): boolean {
  return (
    candidate ||
    features.forwardAsciiPunctuation ||
    features.forwardShortTextReplacements ||
    event.isComposing === true ||
    event.keyCode === 229 ||
    event.which === 229 ||
    event.key === 'Process'
  )
}

export function logNativeForwarderPendingTimeout(
  claimedPress: ClaimedPress,
  terminalElement: HTMLElement
): void {
  logTerminalImeDiagnostic('native-forwarder-pending-timeout', {
    claimedPress,
    target: summarizeElement(terminalElement)
  })
}

export function logNativeForwarderKeydown(
  context: ForwarderLogContext & {
    compositionActive: boolean
    features: MacNativeTextInputSourceFeatures
    candidate: boolean
  }
): void {
  logTerminalImeDiagnostic('native-forwarder-keydown', {
    event: summarizeKeyboardEvent(context.event),
    compositionActive: context.compositionActive,
    features: context.features,
    candidate: context.candidate,
    pendingForward: context.pendingForward,
    claimedPress: context.claimedPress,
    target: summarizeElement(context.terminalElement)
  })
}

export function logNativeForwarderClaimedKeydown(
  event: NativeTextKeyEvent,
  features: MacNativeTextInputSourceFeatures,
  claimedPress: ClaimedPress,
  terminalElement: HTMLElement
): void {
  logTerminalImeDiagnostic('native-forwarder-claimed-keydown', {
    event: summarizeKeyboardEvent(event),
    features,
    claimedPress,
    target: summarizeElement(terminalElement)
  })
}

export function logNativeForwarderRejected(
  scope: string,
  context: ForwarderLogContext,
  extras: Record<string, unknown> = {}
): void {
  logTerminalImeDiagnostic(scope, {
    event: summarizeKeyboardEvent(context.event),
    pendingForward: context.pendingForward,
    claimedPress: context.claimedPress,
    target: summarizeElement(context.terminalElement),
    ...extras
  })
}

export function logNativeForwarderInput(
  scope: string,
  event: Event,
  claimedPress: ClaimedPress
): void {
  logTerminalImeDiagnostic(scope, {
    event: summarizeTextInputEvent(event),
    claimedPress,
    target: summarizeElement(event.target)
  })
}

export function logNativeForwarderCancel(
  reason: string,
  pendingForward: boolean,
  claimedPress: ClaimedPress,
  terminalElement: HTMLElement
): void {
  if (!pendingForward && !claimedPress) {
    return
  }
  logTerminalImeDiagnostic('native-forwarder-cancel-pending', {
    reason,
    pendingForward,
    claimedPress,
    target: summarizeElement(terminalElement)
  })
}
