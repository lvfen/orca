import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '../theme/mobile-theme'
import type {
  RelayV2ReconnectAction,
  RelayV2ReconnectPresentation
} from './relay-v2-reconnect-state-machine'

const actionLabels: Record<RelayV2ReconnectAction, string> = {
  retry: 'Retry',
  repair: 'Re-pair',
  remove: 'Remove'
}

export function RelayV2ReconnectBanner({
  presentation,
  onRetry,
  onRepair,
  onRemove
}: {
  presentation: RelayV2ReconnectPresentation
  onRetry: () => void
  onRepair: () => void
  onRemove: () => void
}) {
  return (
    <View style={styles.banner}>
      <View style={styles.titleRow}>
        {presentation.showSpinner ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : null}
        <Text style={[styles.title, presentation.severity === 'error' && styles.errorTitle]}>
          {presentation.title}
        </Text>
      </View>
      <Text style={styles.message}>{presentation.message}</Text>
      <View style={styles.actions}>
        {presentation.actions.map((action) => (
          <Pressable
            key={action}
            style={styles.action}
            onPress={() => {
              if (action === 'retry') {
                onRetry()
              } else if (action === 'repair') {
                onRepair()
              } else {
                onRemove()
              }
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.actionText, action === 'remove' && styles.removeText]}>
              {actionLabels[action]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.bgPanel,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs
  },
  title: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600'
  },
  errorTitle: {
    color: colors.statusRed
  },
  message: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing.sm
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg
  },
  action: {
    paddingVertical: spacing.xs
  },
  actionText: {
    color: colors.accentBlue,
    fontSize: 13,
    fontWeight: '600'
  },
  removeText: {
    color: colors.statusRed
  }
})
