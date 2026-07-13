import { Linking } from 'react-native'
import { File as FsFile, Paths } from 'expo-file-system'
import * as ExpoCrypto from 'expo-crypto'
import { openMobileConfigAsync } from '@orca/expo-profile-installer'
import { decodeRelayCertificateToken } from '../transport/relay-token'
import type { RelayInviteV2Payload } from './relay-v2-invite'
import { buildRelayV2CertificateMobileConfig } from './relay-v2-certificate-profile'

export async function openRelayCertificateToken(
  token: string
): Promise<'opened' | 'invalid' | 'failed'> {
  const certificate = decodeRelayCertificateToken(token)
  if (!certificate) {
    return 'invalid'
  }
  try {
    if (await openMobileConfigAsync(certificate.iosMobileConfigB64, 'orca-relay-ca.mobileconfig')) {
      return 'opened'
    }
    const file = new FsFile(Paths.cache, `orca-relay-ca-${Date.now()}.mobileconfig`)
    file.create({ overwrite: true })
    file.write(certificate.iosMobileConfigB64, { encoding: 'base64' })
    await Linking.openURL(file.uri)
    return 'opened'
  } catch (error) {
    console.warn('[relay] certificate install failed', error)
    return 'failed'
  }
}

export async function openRelayV2CertificateProfile(
  invite: RelayInviteV2Payload
): Promise<'opened' | 'failed'> {
  try {
    const mobileConfig = buildRelayV2CertificateMobileConfig({
      invite,
      profileUuid: randomUuid(),
      certificateUuid: randomUuid()
    })
    // Why: iOS rejects app-sandbox file:// profile URLs; the native opener
    // serves a short-lived localhost URL so the system profile installer owns it.
    if (
      await openMobileConfigAsync(
        stringToBase64Utf8(mobileConfig),
        `orca-relay-ca-${relayHost(invite.relayUrl)}.mobileconfig`
      )
    ) {
      return 'opened'
    }
    const file = new FsFile(Paths.cache, `orca-relay-v2-ca-${Date.now()}.mobileconfig`)
    file.create({ overwrite: true })
    file.write(mobileConfig)
    await Linking.openURL(file.uri)
    return 'opened'
  } catch (error) {
    console.warn('[relay-v2] certificate install failed', error)
    return 'failed'
  }
}

function randomUuid(): string {
  const bytes = ExpoCrypto.getRandomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`
}

function stringToBase64Utf8(value: string): string {
  return btoa(
    encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
  )
}

function relayHost(relayUrl: string): string {
  try {
    return new URL(relayUrl).host.replace(/[^A-Za-z0-9.-]/g, '-')
  } catch {
    return 'local'
  }
}
