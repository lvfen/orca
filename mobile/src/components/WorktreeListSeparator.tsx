import { View, StyleSheet } from 'react-native'
import { colors, spacing } from '../theme/mobile-theme'

// Thin divider between worktree rows in the host screen's SectionList.
export function WorktreeListSeparator() {
  return <View style={styles.separator} />
}

const styles = StyleSheet.create({
  separator: {
    height: 1,
    backgroundColor: colors.borderSubtle,
    marginLeft: spacing.lg + 24,
    marginRight: spacing.lg
  }
})
