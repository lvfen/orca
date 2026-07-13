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

export function encodeRelayV2ServerMessage(message: RelayV2ServerMessage): string {
  return JSON.stringify(message)
}

export function parseRelayV2ClientMessage(raw: string): RelayV2ClientMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }
  switch (parsed.type) {
    case 'pc-hello':
      return parsePcHello(parsed)
    case 'channel-create':
      return parseChannelCreate(parsed)
    case 'mobile-join':
      return parseMobileJoin(parsed)
    case 'mobile-resume':
      return parseMobileResume(parsed)
    default:
      return null
  }
}

export function isRelayInviteV2Payload(value: unknown): value is RelayInviteV2Payload {
  if (!isRecord(value)) {
    return false
  }
  return (
    value.v === RELAY_V2_PROTOCOL_VERSION &&
    value.type === 'orca-relay-invite' &&
    hasNonEmptyStrings(value, [
      'relayUrl',
      'pcId',
      'channelId',
      'inviteToken',
      'pcPublicKeyB64',
      'serverCaSha256',
      'serverCaDerB64'
    ])
  )
}

function parsePcHello(value: Record<string, unknown>): PcHelloMessage | null {
  if (
    value.v !== RELAY_V2_PROTOCOL_VERSION ||
    !hasNonEmptyStrings(value, ['pcId', 'pcName', 'pcSecret', 'publicKeyB64'])
  ) {
    return null
  }
  return {
    type: 'pc-hello',
    v: RELAY_V2_PROTOCOL_VERSION,
    pcId: value.pcId,
    pcName: value.pcName,
    pcSecret: value.pcSecret,
    publicKeyB64: value.publicKeyB64
  }
}

function parseChannelCreate(value: Record<string, unknown>): ChannelCreateMessage | null {
  if (value.mode !== 'keep-existing' && value.mode !== 'disconnect-existing') {
    return null
  }
  return { type: 'channel-create', mode: value.mode }
}

function parseMobileJoin(value: Record<string, unknown>): MobileJoinMessage | null {
  if (
    value.v !== RELAY_V2_PROTOCOL_VERSION ||
    !hasNonEmptyStrings(value, ['channelId', 'inviteToken', 'mobileDeviceId', 'mobileName'])
  ) {
    return null
  }
  return {
    type: 'mobile-join',
    v: RELAY_V2_PROTOCOL_VERSION,
    channelId: value.channelId,
    inviteToken: value.inviteToken,
    mobileDeviceId: value.mobileDeviceId,
    mobileName: value.mobileName
  }
}

function parseMobileResume(value: Record<string, unknown>): MobileResumeMessage | null {
  if (
    value.v !== RELAY_V2_PROTOCOL_VERSION ||
    !hasNonEmptyStrings(value, ['pcId', 'mobileDeviceId', 'resumeToken'])
  ) {
    return null
  }
  return {
    type: 'mobile-resume',
    v: RELAY_V2_PROTOCOL_VERSION,
    pcId: value.pcId,
    mobileDeviceId: value.mobileDeviceId,
    resumeToken: value.resumeToken
  }
}

function hasNonEmptyStrings<T extends string>(
  value: Record<string, unknown>,
  keys: T[]
): value is Record<T, string> & Record<string, unknown> {
  return keys.every((key) => typeof value[key] === 'string' && value[key].length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
