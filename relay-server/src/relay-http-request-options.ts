import type { RelayConfig } from './config.js'
import type { RelayMetricsSnapshot } from './relay-metrics.js'
import type { RelayHttpRequestOptions } from './relay-server-http.js'
import type { RelayV2Runtime } from './v2/relay-v2-runtime.js'

export function buildRelayHttpRequestOptions(input: {
  config: RelayConfig
  metrics: RelayMetricsSnapshot
  v2Runtime: RelayV2Runtime | null
}): RelayHttpRequestOptions {
  const options: RelayHttpRequestOptions = {
    metrics: input.metrics,
    adminRuntime: input.v2Runtime?.adminRuntime ?? null
  }
  if (input.config.adminToken) {
    options.adminToken = input.config.adminToken
  }
  if (input.config.certificateDiscovery) {
    options.certificateDiscovery = input.config.certificateDiscovery
  }
  return options
}
