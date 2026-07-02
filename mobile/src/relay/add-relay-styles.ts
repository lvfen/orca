import { StyleSheet } from 'react-native'
import { colors, spacing, radii, typography } from '../theme/mobile-theme'

// Why: extracted from app/add-relay.tsx to keep the screen module under the
// max-lines budget; this file holds only the relay "Add via Server Token"
// screen's visual styling.
export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  steps: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginLeft: 7
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary
  },
  stepText: {
    flex: 1,
    fontSize: typography.bodySize,
    color: colors.textSecondary
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs
  },
  tokenField: {
    minHeight: 96,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.card,
    padding: spacing.md,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontFamily: 'monospace'
  },
  inlineError: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    marginTop: spacing.sm,
    marginLeft: spacing.xs
  },
  cameraWrap: {
    flex: 1,
    borderRadius: radii.camera,
    overflow: 'hidden'
  },
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.camera
  },
  camera: {
    ...StyleSheet.absoluteFillObject
  },
  reticle: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  reticleFrame: {
    position: 'relative'
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: 'rgba(255,255,255,0.7)'
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 6 },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 6
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 6
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 6
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    fontSize: typography.titleSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm
  },
  subtitle: {
    maxWidth: 310,
    fontSize: typography.bodySize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20
  },
  connectingText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginTop: spacing.lg
  },
  logSlot: {
    width: '100%',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button
  },
  fullWidthButton: {
    marginTop: spacing.lg
  },
  primaryButtonDim: {
    opacity: 0.5
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  pasteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button
  },
  pasteButtonPressed: {
    opacity: 0.6
  },
  pasteButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  errorActions: {
    alignItems: 'center',
    gap: spacing.sm
  },
  secondaryButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radii.button
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  }
})
