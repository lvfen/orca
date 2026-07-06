import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { base64urlEncode, generateSecret } from '../token.js'

const PC_ID_BYTES = 12
const CHANNEL_ID_BYTES = 12
const MOBILE_DEVICE_ID_BYTES = 12
const TOKEN_HASH_PREFIX = 'sha256:'

export function generatePcId(): string {
  return `pc_${base64urlEncode(randomBytes(PC_ID_BYTES))}`
}

export function generateChannelId(): string {
  return `ch_${base64urlEncode(randomBytes(CHANNEL_ID_BYTES))}`
}

export function generateMobileDeviceId(): string {
  return `mobile_${base64urlEncode(randomBytes(MOBILE_DEVICE_ID_BYTES))}`
}

export function generatePcSecret(): string {
  return generateSecret()
}

export function generateInviteToken(): string {
  return generateSecret()
}

export function generateResumeToken(): string {
  return generateSecret()
}

export function hashBearerToken(token: string): string {
  return `${TOKEN_HASH_PREFIX}${createHash('sha256').update(token, 'utf8').digest('base64')}`
}

// Why: v2 credentials are bearer tokens. Store only hashes and compare hashes in
// constant time so a leaked store file cannot be used directly as a credential.
export function verifyBearerToken(token: string, expectedHash: string): boolean {
  if (!expectedHash.startsWith(TOKEN_HASH_PREFIX)) {
    return false
  }
  const actual = Buffer.from(hashBearerToken(token), 'utf8')
  const expected = Buffer.from(expectedHash, 'utf8')
  if (actual.length !== expected.length) {
    return false
  }
  return timingSafeEqual(actual, expected)
}
