export const RELAY_V2_PROTOCOL_VERSION = 2

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
  deviceToken: string
}

type CompactRelayV2InvitePayload = {
  v: typeof RELAY_V2_PROTOCOL_VERSION
  t: 'r'
  u: string
  p: string
  c: string
  i: string
  k: string
  h: string
  a: string
  d: string
}

export type RelayV2MobileJoin = {
  type: 'mobile-join'
  v: typeof RELAY_V2_PROTOCOL_VERSION
  channelId: string
  inviteToken: string
  mobileDeviceId: string
  mobileName: string
}

export type RelayV2MobileResume = {
  type: 'mobile-resume'
  v: typeof RELAY_V2_PROTOCOL_VERSION
  pcId: string
  mobileDeviceId: string
  resumeToken: string
}

export type RelayV2MobileBindAck = {
  type: 'mobile-bind-ack'
  pcId: string
  mobileDeviceId: string
  resumeToken: string
  resumeTokenExpiresAt: number
}

export type RelayV2MobileResumeAck = {
  type: 'mobile-resume-ack'
  pcId: string
  mobileDeviceId: string
}

export type RelayV2ServerMessage = RelayV2MobileBindAck | RelayV2MobileResumeAck

export function decodeRelayV2Invite(raw: string): RelayInviteV2Payload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) {
    return null
  }
  const compact = decodeCompactRelayV2Invite(parsed)
  if (compact) {
    return compact
  }
  if (
    parsed.v !== RELAY_V2_PROTOCOL_VERSION ||
    parsed.type !== 'orca-relay-invite' ||
    !hasNonEmptyStrings(parsed, [
      'relayUrl',
      'pcId',
      'channelId',
      'inviteToken',
      'pcPublicKeyB64',
      'serverCaSha256',
      'serverCaDerB64',
      'deviceToken'
    ])
  ) {
    return null
  }
  return parsed as RelayInviteV2Payload
}

function decodeCompactRelayV2Invite(parsed: Record<string, unknown>): RelayInviteV2Payload | null {
  if (
    parsed.v !== RELAY_V2_PROTOCOL_VERSION ||
    parsed.t !== 'r' ||
    !hasNonEmptyStrings(parsed, ['u', 'p', 'c', 'i', 'k', 'h', 'a', 'd'])
  ) {
    return null
  }
  const compact = parsed as CompactRelayV2InvitePayload
  return {
    v: RELAY_V2_PROTOCOL_VERSION,
    type: 'orca-relay-invite',
    relayUrl: compact.u,
    pcId: compact.p,
    channelId: compact.c,
    inviteToken: compact.i,
    pcPublicKeyB64: compact.k,
    serverCaSha256: compact.h,
    serverCaDerB64: compact.a,
    deviceToken: compact.d
  }
}

export function encodeRelayV2MobileJoin(message: RelayV2MobileJoin): string {
  return JSON.stringify(message)
}

export function encodeRelayV2MobileResume(message: RelayV2MobileResume): string {
  return JSON.stringify(message)
}

export function parseRelayV2ServerMessage(raw: string): RelayV2ServerMessage | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }
  if (
    parsed.type === 'mobile-bind-ack' &&
    hasNonEmptyStrings(parsed, ['pcId', 'mobileDeviceId', 'resumeToken']) &&
    typeof parsed.resumeTokenExpiresAt === 'number'
  ) {
    return {
      type: 'mobile-bind-ack',
      pcId: parsed.pcId,
      mobileDeviceId: parsed.mobileDeviceId,
      resumeToken: parsed.resumeToken,
      resumeTokenExpiresAt: parsed.resumeTokenExpiresAt
    }
  }
  if (
    parsed.type === 'mobile-resume-ack' &&
    hasNonEmptyStrings(parsed, ['pcId', 'mobileDeviceId'])
  ) {
    return {
      type: 'mobile-resume-ack',
      pcId: parsed.pcId,
      mobileDeviceId: parsed.mobileDeviceId
    }
  }
  return null
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
