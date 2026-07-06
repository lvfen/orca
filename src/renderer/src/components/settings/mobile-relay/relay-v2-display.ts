import type {
  DesktopRelayV2Status,
  DesktopRelayV2ConnectionState
} from '@/../../shared/relay-v2-desktop'
import type { MobileBindingState, PcMobileSummary } from '@/../../shared/relay-v2-protocol'
import { translate } from '@/i18n/i18n'

export type RelayV2Tone = 'connected' | 'pending' | 'danger' | 'idle'

export function relayV2Tone(state: DesktopRelayV2ConnectionState): RelayV2Tone {
  switch (state) {
    case 'connected':
      return 'connected'
    case 'connecting':
    case 'relay-unavailable':
      return 'pending'
    case 'certificate-required':
    case 'unauthorized':
      return 'danger'
    case 'idle':
      return 'idle'
  }
}

export function relayV2StatusLabel(status: DesktopRelayV2Status): string {
  switch (status.state) {
    case 'idle':
      return translate('auto.components.settings.mobileRelay.v2.idle', 'Not configured')
    case 'connecting':
      return translate('auto.components.settings.mobileRelay.v2.connecting', 'Connecting')
    case 'connected':
      return translate('auto.components.settings.mobileRelay.v2.connected', 'Connected')
    case 'certificate-required':
      return translate(
        'auto.components.settings.mobileRelay.v2.certificateRequired',
        'Certificate required'
      )
    case 'relay-unavailable':
      return translate('auto.components.settings.mobileRelay.v2.unavailable', 'Relay unavailable')
    case 'unauthorized':
      return translate('auto.components.settings.mobileRelay.v2.unauthorized', 'Unauthorized')
  }
}

export function mobileStateLabel(state: MobileBindingState): string {
  switch (state) {
    case 'connected':
      return translate('auto.components.settings.mobileRelay.v2.mobileConnected', 'Online')
    case 'reconnecting':
      return translate('auto.components.settings.mobileRelay.v2.mobileReconnecting', 'Reconnecting')
    case 'offline':
      return translate('auto.components.settings.mobileRelay.v2.mobileOffline', 'Offline')
    case 'revoked':
      return translate('auto.components.settings.mobileRelay.v2.mobileRevoked', 'Revoked')
  }
}

export function mobileSummaryLabel(mobile: PcMobileSummary | null, now = Date.now()): string {
  if (!mobile) {
    return translate('auto.components.settings.mobileRelay.v2.noMobile', 'No phone bound')
  }
  return translate(
    'auto.components.settings.mobileRelay.v2.mobileSummary',
    '{{name}} · {{state}} · {{lastSeen}}',
    {
      name: mobile.mobileName,
      state: mobileStateLabel(mobile.state),
      lastSeen: formatLastSeen(mobile.lastSeenAt, now)
    }
  )
}

export function formatLastSeen(lastSeenAt: number, now = Date.now()): string {
  if (!Number.isFinite(lastSeenAt) || lastSeenAt <= 0) {
    return translate('auto.components.settings.mobileRelay.v2.lastSeenNever', 'never seen')
  }
  const elapsedMs = Math.max(0, now - lastSeenAt)
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) {
    return translate('auto.components.settings.mobileRelay.v2.lastSeenNow', 'just now')
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return translate(
      'auto.components.settings.mobileRelay.v2.lastSeenMinutes',
      '{{count}} min ago',
      { count: minutes }
    )
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return translate('auto.components.settings.mobileRelay.v2.lastSeenHours', '{{count}} h ago', {
      count: hours
    })
  }
  const days = Math.floor(hours / 24)
  return translate('auto.components.settings.mobileRelay.v2.lastSeenDays', '{{count}} d ago', {
    count: days
  })
}
