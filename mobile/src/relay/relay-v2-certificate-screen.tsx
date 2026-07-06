import { Text, Pressable, View, type ViewStyle } from 'react-native'
import { ChevronLeft, ShieldCheck } from 'lucide-react-native'
import type { RelayInviteV2Payload } from './relay-v2-invite'
import { colors } from '../theme/mobile-theme'
import { styles } from './add-relay-styles'

type Props = {
  containerPadding: ViewStyle
  invite: RelayInviteV2Payload
  notice: string
  error: string
  onBack: () => void
  onInstall: () => void
  onContinue: () => void
}

export function RelayV2CertificateScreen({
  containerPadding,
  invite,
  notice,
  error,
  onBack,
  onInstall,
  onContinue
}: Props) {
  return (
    <View style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>
      <View style={styles.certificatePanel}>
        <ShieldCheck size={24} color={colors.textSecondary} />
        <Text style={styles.title}>Install relay certificate</Text>
        <Text style={styles.subtitle}>{invite.relayUrl}</Text>
        <Text style={styles.certificateInstruction}>
          After installation, enable Full Trust for this CA in iOS Certificate Trust Settings. Then
          return and continue.
        </Text>
        <Text style={styles.certificateFingerprint}>{invite.serverCaSha256}</Text>
      </View>
      {notice ? <Text style={styles.inlineNotice}>{notice}</Text> : null}
      {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      <View style={styles.errorActions}>
        <Pressable style={styles.primaryButton} onPress={onInstall}>
          <Text style={styles.primaryButtonText}>Open Profile</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onContinue}>
          <Text style={styles.secondaryButtonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  )
}
