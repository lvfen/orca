import AsyncStorage from '@react-native-async-storage/async-storage'
import * as ExpoCrypto from 'expo-crypto'

const MOBILE_DEVICE_ID_KEY = 'orca:relay-v2:mobile-device-id'

export type StoredRelayV2Binding = {
  relayUrl: string
  pcId: string
  pcName: string
  mobileDeviceId: string
  resumeToken: string
  resumeTokenExpiresAt: number
  pcPublicKeyB64: string
  serverCaSha256: string
}

export async function getOrCreateRelayV2MobileDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(MOBILE_DEVICE_ID_KEY)
  if (existing) {
    return existing
  }
  const next = `mobile_${randomBase64Url(16)}`
  await AsyncStorage.setItem(MOBILE_DEVICE_ID_KEY, next)
  return next
}

function randomBase64Url(byteLength: number): string {
  const bytes = ExpoCrypto.getRandomBytes(byteLength)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
