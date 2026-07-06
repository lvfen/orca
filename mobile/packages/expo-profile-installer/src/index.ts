import { Platform } from 'react-native'
import { requireNativeModule } from 'expo-modules-core'

type ExpoProfileInstallerModule = {
  openMobileConfigAsync: (base64Content: string, fileName: string) => Promise<boolean>
}

let nativeModule: ExpoProfileInstallerModule | null = null

function getNativeModule(): ExpoProfileInstallerModule | null {
  if (Platform.OS !== 'ios') {
    return null
  }
  nativeModule ??= requireNativeModule<ExpoProfileInstallerModule>('ExpoProfileInstaller')
  return nativeModule
}

export async function openMobileConfigAsync(
  base64Content: string,
  fileName = 'orca-relay-ca.mobileconfig'
): Promise<boolean> {
  const module = getNativeModule()
  if (!module) {
    return false
  }
  return module.openMobileConfigAsync(base64Content, fileName)
}
