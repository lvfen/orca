import {
  RELAY_V2_PROTOCOL_VERSION,
  type ChannelCreateMessage,
  type ChannelCreateRequiresConfirmationMessage,
  type ChannelCreatedMessage,
  type MobileBindAckMessage,
  type MobileBindingState,
  type MobileJoinMessage,
  type MobileResumeAckMessage,
  type MobileResumeMessage,
  type MobileStateMessage,
  type PcHelloAckMessage,
  type PcHelloMessage,
  type PcMobileSummary,
  type RelayInviteV2Payload,
  type RelayV2ClientMessage,
  type RelayV2ServerMessage
} from './relay-v2-protocol-types'

export function parseRelayV2ClientMessage(raw: string): RelayV2ClientMessage | null {
  const parsed = parseJsonRecord(raw)
  if (!parsed || typeof parsed.type !== 'string') {
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

export function parseRelayV2ServerMessage(raw: string): RelayV2ServerMessage | null {
  const parsed = parseJsonRecord(raw)
  if (!parsed || typeof parsed.type !== 'string') {
    return null
  }
  switch (parsed.type) {
    case 'pc-hello-ack':
      return parsePcHelloAck(parsed)
    case 'channel-create-requires-confirmation':
      return parseChannelCreateRequiresConfirmation(parsed)
    case 'channel-created':
      return parseChannelCreated(parsed)
    case 'mobile-bind-ack':
      return parseMobileBindAck(parsed)
    case 'mobile-resume-ack':
      return parseMobileResumeAck(parsed)
    case 'mobile-state':
      return parseMobileState(parsed)
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
    !hasNonEmptyStrings(value, ['pcId', 'pcName', 'pcSecret', 'publicKeyB64', 'accessToken'])
  ) {
    return null
  }
  return {
    type: 'pc-hello',
    v: RELAY_V2_PROTOCOL_VERSION,
    pcId: value.pcId,
    pcName: value.pcName,
    pcSecret: value.pcSecret,
    publicKeyB64: value.publicKeyB64,
    accessToken: value.accessToken
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

function parsePcHelloAck(value: Record<string, unknown>): PcHelloAckMessage | null {
  if (value.state !== 'online' || typeof value.pcId !== 'string' || value.pcId.length === 0) {
    return null
  }
  if (value.mobile !== null && !isPcMobileSummary(value.mobile)) {
    return null
  }
  return {
    type: 'pc-hello-ack',
    pcId: value.pcId,
    state: 'online',
    mobile: value.mobile
  }
}

function parseChannelCreateRequiresConfirmation(
  value: Record<string, unknown>
): ChannelCreateRequiresConfirmationMessage | null {
  if (
    !hasNonEmptyStrings(value, ['mobileDeviceId', 'mobileName']) ||
    !isMobileBindingState(value.mobileState) ||
    typeof value.lastSeenAt !== 'number'
  ) {
    return null
  }
  return {
    type: 'channel-create-requires-confirmation',
    mobileDeviceId: value.mobileDeviceId,
    mobileName: value.mobileName,
    mobileState: value.mobileState,
    lastSeenAt: value.lastSeenAt
  }
}

function parseChannelCreated(value: Record<string, unknown>): ChannelCreatedMessage | null {
  if (
    !hasNonEmptyStrings(value, ['channelId', 'inviteToken']) ||
    typeof value.expiresAt !== 'number' ||
    !isRelayInviteV2Payload(value.qrPayload)
  ) {
    return null
  }
  return {
    type: 'channel-created',
    channelId: value.channelId,
    inviteToken: value.inviteToken,
    expiresAt: value.expiresAt,
    qrPayload: value.qrPayload
  }
}

function parseMobileBindAck(value: Record<string, unknown>): MobileBindAckMessage | null {
  if (
    !hasNonEmptyStrings(value, ['pcId', 'mobileDeviceId', 'resumeToken']) ||
    typeof value.resumeTokenExpiresAt !== 'number'
  ) {
    return null
  }
  return {
    type: 'mobile-bind-ack',
    pcId: value.pcId,
    mobileDeviceId: value.mobileDeviceId,
    resumeToken: value.resumeToken,
    resumeTokenExpiresAt: value.resumeTokenExpiresAt
  }
}

function parseMobileResumeAck(value: Record<string, unknown>): MobileResumeAckMessage | null {
  if (!hasNonEmptyStrings(value, ['pcId', 'mobileDeviceId'])) {
    return null
  }
  return {
    type: 'mobile-resume-ack',
    pcId: value.pcId,
    mobileDeviceId: value.mobileDeviceId
  }
}

function parseMobileState(value: Record<string, unknown>): MobileStateMessage | null {
  if (!isMobileBindingState(value.state) || typeof value.lastSeenAt !== 'number') {
    return null
  }
  const message: MobileStateMessage = {
    type: 'mobile-state',
    state: value.state,
    lastSeenAt: value.lastSeenAt
  }
  if (typeof value.mobileDeviceId === 'string') {
    message.mobileDeviceId = value.mobileDeviceId
  }
  if (typeof value.mobileName === 'string') {
    message.mobileName = value.mobileName
  }
  return message
}

function isPcMobileSummary(value: unknown): value is PcMobileSummary {
  return (
    isRecord(value) &&
    hasNonEmptyStrings(value, ['mobileDeviceId', 'mobileName']) &&
    isMobileBindingState(value.state) &&
    typeof value.lastSeenAt === 'number'
  )
}

function isMobileBindingState(value: unknown): value is MobileBindingState {
  return (
    value === 'connected' || value === 'reconnecting' || value === 'offline' || value === 'revoked'
  )
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return isRecord(parsed) ? parsed : null
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
