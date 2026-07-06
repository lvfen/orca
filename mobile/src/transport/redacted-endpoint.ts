export function redactedEndpoint(endpoint: string): string {
  try {
    const match = endpoint.match(/^wss?:\/\/([^/]+)/i)
    return match ? match[1]! : 'unknown'
  } catch {
    return 'unknown'
  }
}
