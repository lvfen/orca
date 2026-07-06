import { Text, Pressable, TextInput, View, type ViewStyle } from 'react-native'
import { ChevronLeft } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './add-relay-styles'

type RelayTokenEntryScreenProps = {
  containerPadding: ViewStyle
  tokenInput: string
  tokenError: string
  tokenNotice: string
  onTokenInputChange: (value: string) => void
  onBack: () => void
  onContinue: () => void
  onScanRelayV2: () => void
}

function Step({ number, text }: { number: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNumber}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  )
}

export function RelayTokenEntryScreen({
  containerPadding,
  tokenInput,
  tokenError,
  tokenNotice,
  onTokenInputChange,
  onBack,
  onContinue,
  onScanRelayV2
}: RelayTokenEntryScreenProps) {
  return (
    <View style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={onBack}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>
      <View style={styles.steps}>
        <Step number={1} text="Open Remote relay on your PC and connect to the relay URL" />
        <Step number={2} text="Scan the relay QR shown on the PC" />
        <Step number={3} text="Paste a relay invite or certificate token only when needed" />
      </View>
      <Pressable style={[styles.secondaryButton, styles.fullWidthButton]} onPress={onScanRelayV2}>
        <Text style={styles.secondaryButtonText}>Scan relay QR</Text>
      </Pressable>
      <Text style={styles.fieldLabel}>Relay invite or certificate token</Text>
      <TextInput
        style={styles.tokenField}
        value={tokenInput}
        onChangeText={onTokenInputChange}
        placeholder='{"v":2,"type":"orca-relay-invite",...} or orca-cert_...'
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        textAlignVertical="top"
      />
      {tokenError ? <Text style={styles.inlineError}>{tokenError}</Text> : null}
      {tokenNotice ? <Text style={styles.inlineNotice}>{tokenNotice}</Text> : null}
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          styles.fullWidthButton,
          (pressed || tokenInput.trim().length === 0) && styles.primaryButtonDim
        ]}
        disabled={tokenInput.trim().length === 0}
        onPress={onContinue}
      >
        <Text style={styles.primaryButtonText}>Continue</Text>
      </Pressable>
    </View>
  )
}
