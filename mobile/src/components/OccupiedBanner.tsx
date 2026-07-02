import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors, spacing } from '../theme/mobile-theme'

// Why: relay close code 4409 (the host slot was taken over by the same token on
// another device) is terminal — the client deliberately stops auto-reconnecting,
// since two ends sharing one token would otherwise kick each other forever. The
// only recovery is to re-pair from the PC (which mints fresh tokens).
export function OccupiedBanner({
  onRepair,
  onRemove
}: {
  onRepair: () => void
  onRemove: () => void
}) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        Connection taken over — this pairing is in use on another device. Re-pair from the PC to
        reclaim it.
      </Text>
      <View style={styles.actions}>
        <Pressable style={styles.action} onPress={onRepair}>
          <Text style={styles.actionText}>Re-pair</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={onRemove}>
          <Text style={[styles.actionText, { color: colors.statusRed }]}>Remove</Text>
        </Pressable>
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
  text: {
    color: colors.statusRed,
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
  }
})
