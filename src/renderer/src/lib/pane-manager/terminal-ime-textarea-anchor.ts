import type { IBuffer } from '@xterm/xterm'
import { resolveCursorAgentImeAnchor, type TerminalImeAnchor } from './terminal-ime-anchor'

type TerminalImeAnchorTarget = {
  cols: number
  rows: number
  element?: HTMLElement | null
  textarea?: HTMLTextAreaElement | null
  buffer?: {
    active?: IBuffer
  }
}

export function syncCursorAgentImeTextareaAnchor(
  terminal: TerminalImeAnchorTarget
): TerminalImeAnchor | null {
  if (typeof terminal.element?.querySelector !== 'function') {
    return null
  }
  const screenElement = terminal.element.querySelector<HTMLElement>('.xterm-screen')
  const textarea = terminal.textarea
  const buffer = terminal.buffer?.active
  if (!screenElement || !textarea || !buffer) {
    return null
  }

  const anchor = resolveCursorAgentImeAnchor({
    buffer,
    rows: terminal.rows,
    cols: terminal.cols,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY
  })
  if (!anchor) {
    return null
  }

  const rect = screenElement.getBoundingClientRect()
  const cellWidth = rect.width / terminal.cols
  const cellHeight = rect.height / terminal.rows
  if (!(cellWidth > 0) || !(cellHeight > 0)) {
    return null
  }

  textarea.style.top = `${anchor.row * cellHeight}px`
  textarea.style.left = `${anchor.column * cellWidth}px`
  return anchor
}
