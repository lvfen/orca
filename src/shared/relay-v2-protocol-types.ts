export const RELAY_V2_PROTOCOL_VERSION = 2

export type MobileBindingState = 'connected' | 'reconnecting' | 'offline' | 'revoked'
export type ChannelState = 'pending' | 'active' | 'expired' | 'revoked'
export type PcConnectionState = 'online' | 'offline'

export type PcMobileSummary = {
  mobileDeviceId: string
  mobileName: string
  state: MobileBindingState
  lastSeenAt: number
}

export type RelayInviteV2Payload = {
  v: typeof RELAY_V2_PROTOCOL_VERSION
  type: 'orca-relay-invite'
  relayUrl: string
  pcId: string
  channelId: string
  inviteToken: string
  pcPublicKeyB64: string
  serverCaSha256: string
  serverCaDerB64: string
  deviceToken?: string
}

export type PcHelloMessage = {
  type: 'pc-hello'
  v: typeof RELAY_V2_PROTOCOL_VERSION
  pcId: string
  pcName: string
  pcSecret: string
  publicKeyB64: string
}

export type ChannelCreateMessage = {
  type: 'channel-create'
  mode: 'keep-existing' | 'disconnect-existing'
}

export type MobileJoinMessage = {
  type: 'mobile-join'
  v: typeof RELAY_V2_PROTOCOL_VERSION
  channelId: string
  inviteToken: string
  mobileDeviceId: string
  mobileName: string
}

export type MobileResumeMessage = {
  type: 'mobile-resume'
  v: typeof RELAY_V2_PROTOCOL_VERSION
  pcId: string
  mobileDeviceId: string
  resumeToken: string
}

export type RelayV2ClientMessage =
  | PcHelloMessage
  | ChannelCreateMessage
  | MobileJoinMessage
  | MobileResumeMessage

export type PcHelloAckMessage = {
  type: 'pc-hello-ack'
  pcId: string
  state: 'online'
  mobile: PcMobileSummary | null
}

export type ChannelCreateRequiresConfirmationMessage = {
  type: 'channel-create-requires-confirmation'
  mobileDeviceId: string
  mobileName: string
  mobileState: MobileBindingState
  lastSeenAt: number
}

export type ChannelCreatedMessage = {
  type: 'channel-created'
  channelId: string
  inviteToken: string
  expiresAt: number
  qrPayload: RelayInviteV2Payload
}

export type MobileBindAckMessage = {
  type: 'mobile-bind-ack'
  pcId: string
  mobileDeviceId: string
  resumeToken: string
  resumeTokenExpiresAt: number
}

export type MobileResumeAckMessage = {
  type: 'mobile-resume-ack'
  pcId: string
  mobileDeviceId: string
}

export type MobileStateMessage = {
  type: 'mobile-state'
  state: MobileBindingState
  mobileDeviceId?: string
  mobileName?: string
  lastSeenAt: number
}

export type RelayV2ServerMessage =
  | PcHelloAckMessage
  | ChannelCreateRequiresConfirmationMessage
  | ChannelCreatedMessage
  | MobileBindAckMessage
  | MobileResumeAckMessage
  | MobileStateMessage

export function encodeRelayV2ClientMessage(message: RelayV2ClientMessage): string {
  return JSON.stringify(message)
}

export function encodeRelayV2ServerMessage(message: RelayV2ServerMessage): string {
  return JSON.stringify(message)
}
