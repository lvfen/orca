import type { ConnectionLogEntry } from '../transport/types'

export const RELAY_V2_IOS_FULL_TRUST_MESSAGE =
  'iOS still does not trust the relay CA. Open Settings > General > About > Certificate Trust Settings, enable Full Trust for the Orca Relay CA, then try again.'

export const RELAY_V2_ANDROID_TRUST_MESSAGE =
  'The relay CA is not trusted by Android. Install the relay certificate from the QR invite, trust it for VPN and apps, then try again.'

const IOS_TRUST_FAILURE_PATTERNS = [
  /osstatus error -9807/i,
  /nsurlerrordomain error -1202/i,
  /certificate verify failed/i
]

const ANDROID_TRUST_FAILURE_PATTERNS = [
  /trust anchor for certification path not found/i,
  /certpathvalidatorexception/i,
  /java\.security\.cert\.certpathvalidator/i
]

export function relayV2TrustFailureMessage(entries: readonly ConnectionLogEntry[]): string | null {
  const diagnosticText = entries
    .map((entry) => `${entry.message}\n${entry.detail ?? ''}`)
    .join('\n')

  if (IOS_TRUST_FAILURE_PATTERNS.some((pattern) => pattern.test(diagnosticText))) {
    return RELAY_V2_IOS_FULL_TRUST_MESSAGE
  }

  if (ANDROID_TRUST_FAILURE_PATTERNS.some((pattern) => pattern.test(diagnosticText))) {
    return RELAY_V2_ANDROID_TRUST_MESSAGE
  }

  return null
}
