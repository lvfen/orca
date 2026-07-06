import type { ConnectionLogEntry } from '../transport/types'

const DEFAULT_RELAY_V2_LOG_LIMIT = 40

export function appendRelayV2ConnectionLog(
  entries: ConnectionLogEntry[],
  entry: ConnectionLogEntry,
  limit = DEFAULT_RELAY_V2_LOG_LIMIT
): ConnectionLogEntry[] {
  const safeLimit = Math.max(1, Math.floor(limit))
  return [...entries, entry].slice(-safeLimit)
}

export function formatRelayV2ConnectionLogEntry(entry: ConnectionLogEntry): string {
  return entry.detail ? `${entry.message}: ${entry.detail}` : entry.message
}
