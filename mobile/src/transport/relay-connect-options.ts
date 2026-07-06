import { RELAY_V2_PROTOCOL_VERSION } from '../relay/relay-v2-invite'
import type { ConnectOptions } from './rpc-client'
import type { HostProfile } from './types'

export function resolveRelayConnectOptions(host: HostProfile): ConnectOptions | undefined {
  if (host.kind === 'relay' && host.mobileToken) {
    return { relay: { mobileToken: host.mobileToken } }
  }
  if (host.kind === 'relay-v2' && host.mobileToken && host.pcId && host.mobileDeviceId) {
    return {
      relayV2: {
        mode: 'resume',
        message: {
          type: 'mobile-resume',
          v: RELAY_V2_PROTOCOL_VERSION,
          pcId: host.pcId,
          mobileDeviceId: host.mobileDeviceId,
          resumeToken: host.mobileToken
        }
      }
    }
  }
  return undefined
}
