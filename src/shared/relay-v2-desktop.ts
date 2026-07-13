import type {
  ChannelCreateRequiresConfirmationMessage,
  ChannelCreatedMessage,
  PcMobileSummary,
  RelayInviteV2Payload
} from './relay-v2-protocol'

export type DesktopRelayV2ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'certificate-required'
  | 'relay-unavailable'
  | 'unauthorized'

export type DesktopRelaySettings = {
  relayUrl: string | null
  pcId: string | null
  pcName: string
  hasAccessToken: boolean
}

export type DesktopRelayV2Status = {
  state: DesktopRelayV2ConnectionState
  relayUrl: string | null
  pcId: string | null
  pcName: string
  attempt: number
  mobile: PcMobileSummary | null
  channelId: string | null
  lastError: string | null
}

export type SaveRelayUrlResult =
  | { ok: true; settings: DesktopRelaySettings; status: DesktopRelayV2Status }
  | { ok: false; reason: 'invalid-url' | 'missing-access-token'; status: DesktopRelayV2Status }

export type RelayV2CreatedInvite = Omit<ChannelCreatedMessage, 'type'> & {
  qrPayload: RelayInviteV2Payload
  qrPayloadJson: string
  qrScanPayload?: string
  qrDataUrl?: string
}

export type CreateInviteResult =
  | { ok: true; invite: RelayV2CreatedInvite; status: DesktopRelayV2Status }
  | {
      ok: false
      reason:
        | 'not-connected'
        | 'confirmation-required'
        | 'certificate-required'
        | 'relay-unavailable'
        | 'unauthorized'
        | 'busy'
        | 'timeout'
      status: DesktopRelayV2Status
      existingMobile?: ChannelCreateRequiresConfirmationMessage
    }

export type InstallCertificateResult =
  | { ok: true; filePath: string; installed?: boolean; appTrusted?: boolean }
  | { ok: false; reason: 'invalid-token' | 'hash-mismatch' | 'open-failed' }

export type InstallDiscoveredCertificateResult =
  | InstallCertificateResult
  | {
      ok: false
      reason: 'invalid-url' | 'download-failed' | 'relay-url-mismatch'
    }
