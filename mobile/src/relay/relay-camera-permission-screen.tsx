import { Text, Pressable, View, type ViewStyle } from 'react-native'
import { ChevronLeft, Clipboard as ClipboardIcon, QrCode } from 'lucide-react-native'
import { TextInputModal } from '../components/TextInputModal'
import { colors } from '../theme/mobile-theme'
import { styles } from './add-relay-styles'

type RelayCameraPermissionScreenProps = {
  containerPadding: ViewStyle
  canAskAgain: boolean
  pasteVisible: boolean
  onBack: () => void
  onRequestPermission: () => void | Promise<unknown>
  onOpenSettings: () => void | Promise<unknown>
  onShowPaste: () => void
  onPasteSubmit: (input: string) => void
  onCancelPaste: () => void
}

export function RelayCameraPermissionScreen({
  containerPadding,
  canAskAgain,
  pasteVisible,
  onBack,
  onRequestPermission,
  onOpenSettings,
  onShowPaste,
  onPasteSubmit,
  onCancelPaste
}: RelayCameraPermissionScreenProps) {
  return (
    <View style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>
      <View style={styles.centered}>
        <Text style={styles.title}>
          {canAskAgain ? 'Scan Remote Relay' : 'Camera Access Disabled'}
        </Text>
        <Text style={styles.subtitle}>
          {canAskAgain
            ? 'Scan the Remote Relay QR from Orca on your desktop, or paste an invite instead.'
            : 'Enable camera access in Settings, or paste a relay invite instead.'}
        </Text>
        <Pressable
          style={styles.primaryButton}
          onPress={canAskAgain ? onRequestPermission : onOpenSettings}
        >
          {canAskAgain && <QrCode size={16} color={colors.bgBase} />}
          <Text style={styles.primaryButtonText}>{canAskAgain ? 'Continue' : 'Open Settings'}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.pasteButton, pressed && styles.pasteButtonPressed]}
          onPress={onShowPaste}
        >
          <ClipboardIcon size={16} color={colors.textSecondary} />
          <Text style={styles.pasteButtonText}>Paste token instead</Text>
        </Pressable>
      </View>
      <TextInputModal
        visible={pasteVisible}
        title="Paste Relay Invite"
        message="Copy the invite shown with the Remote Relay QR on your computer."
        placeholder='{"v":2,"type":"orca-relay-invite",...}'
        onSubmit={onPasteSubmit}
        onCancel={onCancelPaste}
      />
    </View>
  )
}
