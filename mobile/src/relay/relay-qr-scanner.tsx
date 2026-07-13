import { Text, Pressable, View, type LayoutChangeEvent } from 'react-native'
import { CameraView } from 'expo-camera'
import { Clipboard as ClipboardIcon } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './add-relay-styles'

type Props = {
  pasteVisible: boolean
  reticleSize: number
  onCameraLayout: (event: LayoutChangeEvent) => void
  onBarcodeScanned: (event: { data: string }) => void
  onShowPaste: () => void
  onManualEntry: () => void
}

export function RelayQrScanner({
  pasteVisible,
  reticleSize,
  onCameraLayout,
  onBarcodeScanned,
  onShowPaste,
  onManualEntry
}: Props) {
  return (
    <>
      {!pasteVisible && (
        <View style={styles.cameraWrap} onLayout={onCameraLayout}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View style={styles.reticle} pointerEvents="none">
            <View style={[styles.reticleFrame, { width: reticleSize, height: reticleSize }]}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </View>
        </View>
      )}
      {pasteVisible && <View style={styles.cameraPlaceholder} />}
      <Pressable
        style={({ pressed }) => [styles.pasteButton, pressed && styles.pasteButtonPressed]}
        onPress={onShowPaste}
      >
        <ClipboardIcon size={16} color={colors.textSecondary} />
        <Text style={styles.pasteButtonText}>Paste relay invite</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.pasteButtonCompact, pressed && styles.pasteButtonPressed]}
        onPress={onManualEntry}
      >
        <Text style={styles.pasteButtonText}>Enter token manually</Text>
      </Pressable>
    </>
  )
}
