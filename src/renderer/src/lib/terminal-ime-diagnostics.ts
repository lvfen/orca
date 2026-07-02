type TerminalImeDiagnosticEvent = {
  at: number
  scope: string
  details: Record<string, unknown>
}

type KeyboardEventLike = {
  type?: string
  key?: string
  code?: string
  keyCode?: number
  which?: number
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
}

const BUFFER_LIMIT = 500

function isDevBuild(): boolean {
  return import.meta.env?.DEV === true
}

function isExplicitlyEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('ORCA_TERMINAL_IME_DEBUG') === '1'
  } catch {
    return false
  }
}

export function isTerminalImeDiagnosticsEnabled(): boolean {
  return isDevBuild() || isExplicitlyEnabled()
}

export function logTerminalImeDiagnostic(
  scope: string,
  details: Record<string, unknown> = {}
): void {
  if (!isTerminalImeDiagnosticsEnabled()) {
    return
  }
  const target = globalThis as typeof globalThis & {
    __ORCA_TERMINAL_IME_LOG__?: TerminalImeDiagnosticEvent[]
  }
  const entry: TerminalImeDiagnosticEvent = {
    at: typeof performance === 'undefined' ? Date.now() : performance.now(),
    scope,
    details
  }
  const buffer = target.__ORCA_TERMINAL_IME_LOG__ ?? []
  buffer.push(entry)
  if (buffer.length > BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - BUFFER_LIMIT)
  }
  target.__ORCA_TERMINAL_IME_LOG__ = buffer
  console.info('[terminal-ime-debug]', scope, details)
}

export function summarizeKeyboardEvent(event: KeyboardEventLike): Record<string, unknown> {
  return {
    type: event.type,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    which: event.which,
    metaKey: event.metaKey === true,
    ctrlKey: event.ctrlKey === true,
    altKey: event.altKey === true,
    shiftKey: event.shiftKey === true,
    repeat: event.repeat === true,
    isComposing: event.isComposing === true,
    defaultPrevented: event.defaultPrevented === true
  }
}

export function summarizeTextInputEvent(event: Event): Record<string, unknown> {
  const input = typeof InputEvent !== 'undefined' && event instanceof InputEvent ? event : null
  const composition =
    typeof CompositionEvent !== 'undefined' && event instanceof CompositionEvent ? event : null
  return {
    type: event.type,
    data: input?.data ?? composition?.data ?? null,
    inputType: input?.inputType ?? null,
    isComposing: input?.isComposing ?? null
  }
}

export function summarizeElement(
  value: Element | EventTarget | null | undefined
): Record<string, unknown> | null {
  if (value == null || typeof Element === 'undefined' || !(value instanceof Element)) {
    return null
  }
  const tab = value.closest('[data-terminal-tab-id]')
  const leaf = value.closest('[data-leaf-id]')
  const pane = value.closest('[data-pane-id]')
  return {
    tagName: value.tagName.toLowerCase(),
    className: typeof value.className === 'string' ? value.className : '',
    isHelperTextarea: value.classList.contains('xterm-helper-textarea'),
    tabId: tab?.getAttribute('data-terminal-tab-id') ?? null,
    leafId: leaf?.getAttribute('data-leaf-id') ?? null,
    paneId: pane?.getAttribute('data-pane-id') ?? null
  }
}
