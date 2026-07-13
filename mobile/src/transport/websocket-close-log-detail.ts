export function websocketCloseLogDetail(reason: string | undefined): string {
  const trimmedReason = reason?.trim()
  return trimmedReason ? `Will attempt to reconnect: ${trimmedReason}` : 'Will attempt to reconnect'
}
