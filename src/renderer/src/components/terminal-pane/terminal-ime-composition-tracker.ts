import type { IDisposable } from '@xterm/xterm'
import {
  logTerminalImeDiagnostic,
  summarizeElement,
  summarizeTextInputEvent
} from '@/lib/terminal-ime-diagnostics'

export type TerminalImeCompositionTracker = IDisposable & {
  isActive: () => boolean
}

export function installTerminalImeCompositionTracker(
  terminalElement: HTMLElement | null | undefined
): TerminalImeCompositionTracker {
  let active = false
  if (!terminalElement) {
    return {
      isActive: () => active,
      dispose: () => undefined
    }
  }

  const markActive = (): void => {
    active = true
    logTerminalImeDiagnostic('composition-start', {
      active,
      target: summarizeElement(terminalElement)
    })
  }
  const updateComposition = (event: Event): void => {
    active = !(event instanceof CompositionEvent) || event.data !== ''
    logTerminalImeDiagnostic('composition-update', {
      active,
      event: summarizeTextInputEvent(event),
      target: summarizeElement(terminalElement)
    })
  }
  const handleInput = (event: Event): void => {
    if (event instanceof InputEvent && event.inputType === 'insertCompositionText') {
      logTerminalImeDiagnostic('composition-input-retained', {
        active,
        event: summarizeTextInputEvent(event),
        target: summarizeElement(event.target)
      })
      return
    }
    active = false
    logTerminalImeDiagnostic('composition-input-cleared', {
      active,
      event: summarizeTextInputEvent(event),
      target: summarizeElement(event.target)
    })
  }
  const markInactive = (): void => {
    active = false
    logTerminalImeDiagnostic('composition-end-or-blur', {
      active,
      target: summarizeElement(terminalElement)
    })
  }

  terminalElement.addEventListener('compositionstart', markActive, true)
  terminalElement.addEventListener('compositionupdate', updateComposition, true)
  terminalElement.addEventListener('compositionend', markInactive, true)
  terminalElement.addEventListener('input', handleInput, true)
  terminalElement.addEventListener('blur', markInactive, true)

  return {
    isActive: () => active,
    dispose: () => {
      terminalElement.removeEventListener('compositionstart', markActive, true)
      terminalElement.removeEventListener('compositionupdate', updateComposition, true)
      terminalElement.removeEventListener('compositionend', markInactive, true)
      terminalElement.removeEventListener('input', handleInput, true)
      terminalElement.removeEventListener('blur', markInactive, true)
    }
  }
}
