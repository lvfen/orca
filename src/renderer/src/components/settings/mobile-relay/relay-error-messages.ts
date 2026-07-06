import type { CreateInviteResult } from '@/../../shared/relay-v2-desktop'
import { translate } from '@/i18n/i18n'

export function relayInviteErrorMessage(
  reason: Exclude<CreateInviteResult, { ok: true }>['reason']
): string {
  switch (reason) {
    case 'not-connected':
      return translate(
        'auto.components.settings.mobileRelay.notConnected',
        'Relay is not connected'
      )
    case 'certificate-required':
      return translate(
        'auto.components.settings.mobileRelay.certNeeded',
        'Install the relay certificate first'
      )
    case 'relay-unavailable':
      return translate(
        'auto.components.settings.mobileRelay.relayUnavailable',
        'Relay is unavailable'
      )
    case 'unauthorized':
      return translate(
        'auto.components.settings.mobileRelay.unauthorized',
        'Relay authorization failed'
      )
    case 'busy':
      return translate(
        'auto.components.settings.mobileRelay.inviteBusy',
        'An invite is already being created'
      )
    case 'timeout':
      return translate(
        'auto.components.settings.mobileRelay.inviteTimeout',
        'Invite creation timed out'
      )
    case 'confirmation-required':
      return translate(
        'auto.components.settings.mobileRelay.confirmationRequired',
        'Confirm the existing phone binding first'
      )
  }
}

export function discoveredCertificateErrorMessage(reason: string): string {
  switch (reason) {
    case 'invalid-url':
      return translate(
        'auto.components.settings.mobileRelay.certificateInvalidUrl',
        'Invalid relay URL'
      )
    case 'download-failed':
      return translate(
        'auto.components.settings.mobileRelay.certificateDownloadFailed',
        'Could not download the relay certificate'
      )
    case 'relay-url-mismatch':
      return translate(
        'auto.components.settings.mobileRelay.certificateUrlMismatch',
        'The downloaded certificate does not match this relay URL'
      )
    default:
      return translate(
        'auto.components.settings.mobileRelay.certificateFailed',
        'Failed to open certificate token'
      )
  }
}
