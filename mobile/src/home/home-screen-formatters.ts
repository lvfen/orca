// Display formatters for the mobile home screen (host list + aggregate stats).
// Kept out of app/index.tsx so the screen file stays focused on view logic.

export function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.hostname}${url.port ? `:${url.port}` : ''}`
  } catch {
    return endpoint
  }
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  const minutes = totalMinutes % 60
  if (totalHours > 0) {
    return `${totalHours}h ${minutes}m`
  }
  return `${totalMinutes}m`
}
