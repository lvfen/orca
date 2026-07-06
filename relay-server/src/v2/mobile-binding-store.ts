import type { MobileBindingState } from './relay-v2-protocol.js'

export type MobileBinding = {
  mobileDeviceId: string
  mobileName: string
  pcId: string
  resumeTokenHash: string
  resumeTokenExpiresAt: number
  state: MobileBindingState
  connectedAt: number | null
  disconnectedAt: number | null
  lastSeenAt: number
}

export type MobileBindingInput = {
  mobileDeviceId: string
  mobileName: string
  pcId: string
  resumeTokenHash: string
  resumeTokenExpiresAt: number
  now: number
}

export function createMobileBinding(input: MobileBindingInput): MobileBinding {
  return {
    mobileDeviceId: input.mobileDeviceId,
    mobileName: input.mobileName,
    pcId: input.pcId,
    resumeTokenHash: input.resumeTokenHash,
    resumeTokenExpiresAt: input.resumeTokenExpiresAt,
    state: 'connected',
    connectedAt: input.now,
    disconnectedAt: null,
    lastSeenAt: input.now
  }
}

export function refreshMobileBinding(
  record: MobileBinding,
  input: MobileBindingInput
): MobileBinding {
  return {
    ...record,
    mobileName: input.mobileName,
    pcId: input.pcId,
    resumeTokenHash: input.resumeTokenHash,
    resumeTokenExpiresAt: input.resumeTokenExpiresAt,
    state: 'connected',
    connectedAt: input.now,
    disconnectedAt: null,
    lastSeenAt: input.now
  }
}

export function setMobileBindingState(
  record: MobileBinding,
  state: MobileBindingState,
  now: number
): MobileBinding {
  return {
    ...record,
    state,
    connectedAt: state === 'connected' ? now : record.connectedAt,
    disconnectedAt: state === 'connected' ? null : now,
    lastSeenAt: now
  }
}
