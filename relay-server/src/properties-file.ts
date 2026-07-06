export function parseProperties(contents: string): Map<string, string> {
  const properties = new Map<string, string>()
  for (const rawLine of toLogicalLines(contents)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue
    }
    const separatorIndex = findSeparatorIndex(line)
    const rawKey = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
    const key = unescapePropertyPart(rawKey.trim())
    const value = unescapePropertyPart(rawValue.trim())
    if (key) {
      properties.set(key, value)
    }
  }
  return properties
}

function toLogicalLines(contents: string): string[] {
  const lines: string[] = []
  let current = ''
  for (const line of contents.split(/\r?\n/)) {
    if (hasContinuation(line)) {
      current += line.slice(0, -1)
      continue
    }
    lines.push(current + line)
    current = ''
  }
  if (current) {
    lines.push(current)
  }
  return lines
}

function hasContinuation(line: string): boolean {
  let count = 0
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) {
    count++
  }
  return count % 2 === 1
}

function findSeparatorIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if ((char === '=' || char === ':') && !isEscaped(line, i)) {
      return i
    }
  }
  return -1
}

function isEscaped(value: string, index: number): boolean {
  let count = 0
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) {
    count++
  }
  return count % 2 === 1
}

function unescapePropertyPart(value: string): string {
  return value.replace(/\\([nrt\\:=#! ])/g, (_match, char: string) => {
    switch (char) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      default:
        return char
    }
  })
}
