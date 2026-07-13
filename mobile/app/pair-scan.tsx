import { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking,
  type LayoutChangeEvent
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { ChevronLeft, Clipboard as ClipboardIcon, QrCode } from 'lucide-react-native'
import { decodePairingUrl, parsePairingCode } from '../src/transport/pairing'
import {
  connectAndSaveLanPairing,
  type LanPairingFlowResult
} from '../src/transport/lan-pairing-connection-flow'
import type { PairingConnectionAttempt } from '../src/transport/pairing-connection-attempt'
import { RELAY_CERTIFICATE_TOKEN_PREFIX } from '../src/transport/relay-token'
import type { ConnectionLogEntry, PairingOffer } from '../src/transport/types'
import { colors, spacing } from '../src/theme/mobile-theme'
import { TextInputModal } from '../src/components/TextInputModal'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { styles } from '../src/transport/pair-scan-styles'
import { decodeRelayV2Invite, type RelayInviteV2Payload } from '../src/relay/relay-v2-invite'
import { RelayV2CertificateScreen } from '../src/relay/relay-v2-certificate-screen'
import {
  connectAndSaveRelayV2,
  type AddRelayFlowResult
} from '../src/relay/add-relay-connection-flows'
import {
  openRelayCertificateToken,
  openRelayV2CertificateProfile as openRelayV2CertificateProfileFile
} from '../src/relay/relay-certificate-installation'

const SCAN_RETICLE_SCALE = 0.62
const SCAN_RETICLE_MAX_SIZE = 360

type ScanStatus = 'scanning' | 'certificate-required' | 'connecting' | 'error'
type ConnectionKind = 'lan' | 'relay'

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

export default function PairScanScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [status, setStatus] = useState<ScanStatus>('scanning')
  const [connectionKind, setConnectionKind] = useState<ConnectionKind>('lan')
  const [errorMessage, setErrorMessage] = useState('')
  const [noticeMessage, setNoticeMessage] = useState('')
  const [certificateNotice, setCertificateNotice] = useState('')
  const [certificateError, setCertificateError] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const relayV2InviteRef = useRef<RelayInviteV2Payload | null>(null)
  const processingRef = useRef(false)
  const mountedRef = useRef(true)
  const activePairingAttemptRef = useRef<PairingConnectionAttempt | null>(null)

  const setPairScanRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    // Why: pairing attempts can outlive the visible route; dispose them when
    // the scan screen detaches without a passive cleanup-only Effect.
    mountedRef.current = false
    activePairingAttemptRef.current?.dispose()
    activePairingAttemptRef.current = null
  }, [])

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (processingRef.current) {
      return
    }

    const invite = decodeRelayV2Invite(data)
    if (invite) {
      processingRef.current = true
      handleRelayV2Invite(invite)
      return
    }
    const offer = decodePairingUrl(data)
    if (offer) {
      processingRef.current = true
      void testAndSaveLan(offer)
      return
    }

    setStatus('error')
    setErrorMessage('Not a valid Orca QR code')
    processingRef.current = false
  }, [])

  const handlePasteSubmit = useCallback((input: string) => {
    setPasteVisible(false)
    if (processingRef.current) {
      return
    }
    const trimmed = input.trim()

    const invite = decodeRelayV2Invite(trimmed)
    if (invite) {
      processingRef.current = true
      handleRelayV2Invite(invite)
      return
    }
    if (trimmed.startsWith(RELAY_CERTIFICATE_TOKEN_PREFIX)) {
      void openCertificateToken(trimmed)
      return
    }
    const offer = parsePairingCode(trimmed)
    if (offer) {
      processingRef.current = true
      void testAndSaveLan(offer)
      return
    }

    setStatus('error')
    setErrorMessage('Not a valid pairing code or relay invite')
  }, [])

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const next = { width: Math.round(width), height: Math.round(height) }
    setCameraBounds((cur) => (cur.width === next.width && cur.height === next.height ? cur : next))
  }, [])

  function handleRelayV2Invite(invite: RelayInviteV2Payload): void {
    relayV2InviteRef.current = invite
    setConnectionKind('relay')
    setCertificateNotice('')
    setCertificateError('')
    setNoticeMessage('')
    if (invite.serverCaDerB64 !== 'unavailable' && invite.serverCaSha256 !== 'unavailable') {
      setStatus('certificate-required')
      processingRef.current = false
      return
    }
    void testAndSaveRelay(invite)
  }

  async function openCertificateToken(token: string): Promise<void> {
    const result = await openRelayCertificateToken(token)
    if (result === 'opened') {
      setStatus('scanning')
      setErrorMessage('')
      setNoticeMessage(
        'Certificate profile opened. Finish installation in Settings, enable Full Trust, then scan again.'
      )
      processingRef.current = false
      return
    }
    setStatus('error')
    setErrorMessage(
      result === 'invalid'
        ? 'Not a valid certificate token'
        : 'Could not open the certificate profile'
    )
    processingRef.current = false
  }

  async function openRelayV2CertificateProfile(): Promise<void> {
    const invite = relayV2InviteRef.current
    if (!invite) {
      return
    }
    if ((await openRelayV2CertificateProfileFile(invite)) === 'opened') {
      setCertificateError('')
      setCertificateNotice(
        'Profile opened. Finish installation in Settings, enable Full Trust, then continue.'
      )
      return
    }
    setCertificateNotice('')
    setCertificateError('Could not open the certificate profile')
  }

  async function testAndSaveLan(offer: PairingOffer) {
    setConnectionKind('lan')
    setStatus('connecting')
    setNoticeMessage('')
    resetLogs()
    activePairingAttemptRef.current?.dispose()
    handleFlowResult(await connectAndSaveLanPairing({ offer, hooks: createAttemptHooks() }))
  }

  async function testAndSaveRelay(invite: RelayInviteV2Payload) {
    setConnectionKind('relay')
    setStatus('connecting')
    setNoticeMessage('')
    resetLogs()
    activePairingAttemptRef.current?.dispose()
    handleFlowResult(await connectAndSaveRelayV2({ invite, hooks: createAttemptHooks() }))
  }

  function createAttemptHooks() {
    return {
      setActiveAttempt: (attempt: PairingConnectionAttempt) => {
        activePairingAttemptRef.current = attempt
      },
      clearActiveAttempt: (attempt: PairingConnectionAttempt) => {
        if (activePairingAttemptRef.current === attempt) {
          activePairingAttemptRef.current = null
        }
      },
      isActiveAttempt: (attempt: PairingConnectionAttempt) =>
        activePairingAttemptRef.current === attempt,
      isMounted: () => mountedRef.current,
      onLog: (entry: ConnectionLogEntry) => {
        logsRef.current = [...logsRef.current, entry]
        setLogs(logsRef.current)
      }
    }
  }

  function handleFlowResult(result: LanPairingFlowResult | AddRelayFlowResult): void {
    if (result.type === 'cancelled') {
      return
    }
    if (result.type === 'saved') {
      router.replace(`/h/${result.hostId}`)
      return
    }
    setStatus('error')
    setErrorMessage(result.message)
    processingRef.current = false
  }

  function resetLogs(): void {
    logsRef.current = []
    setLogs([])
  }

  function retry() {
    setStatus('scanning')
    setErrorMessage('')
    setNoticeMessage('')
    setCertificateNotice('')
    setCertificateError('')
    relayV2InviteRef.current = null
    resetLogs()
    processingRef.current = false
  }

  // Why: bottom inset accounts for Android 3-button nav bars and iOS
  // home-indicator areas that would otherwise overlap the 'Or paste
  // pairing code' button at the bottom of the scan screen.
  const containerPadding = {
    paddingTop: insets.top + spacing.sm,
    paddingBottom: insets.bottom + spacing.sm
  }
  // Why: iPad camera previews are often rectangular, but QR guides should
  // stay square so the corners still describe the code shape.
  const reticleSize = Math.min(
    Math.round(Math.min(cameraBounds.width, cameraBounds.height) * SCAN_RETICLE_SCALE),
    SCAN_RETICLE_MAX_SIZE
  )

  if (status === 'certificate-required' && relayV2InviteRef.current) {
    return (
      <View ref={setPairScanRootRef} style={styles.routeRoot}>
        <RelayV2CertificateScreen
          containerPadding={containerPadding}
          invite={relayV2InviteRef.current}
          notice={certificateNotice}
          error={certificateError}
          onBack={() => {
            relayV2InviteRef.current = null
            setStatus('scanning')
          }}
          onInstall={() => void openRelayV2CertificateProfile()}
          onContinue={() => void testAndSaveRelay(relayV2InviteRef.current!)}
        />
      </View>
    )
  }

  if (!permission) {
    return (
      <View ref={setPairScanRootRef} style={[styles.container, containerPadding]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false
    return (
      <View ref={setPairScanRootRef} style={[styles.container, containerPadding]}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.centered}>
          <Text style={styles.title}>
            {canAskAgain ? 'Scan Orca QR' : 'Camera Access Disabled'}
          </Text>
          <Text style={styles.subtitle}>
            {canAskAgain
              ? 'Scan the QR code from Orca on your desktop, or paste the code instead.'
              : 'Enable camera access in Settings, or paste the code instead.'}
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={canAskAgain ? requestPermission : () => void Linking.openSettings()}
          >
            {canAskAgain && <QrCode size={16} color={colors.bgBase} />}
            <Text style={styles.primaryButtonText}>
              {canAskAgain ? 'Continue' : 'Open Settings'}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.pasteButton, pressed && styles.pasteButtonPressed]}
            onPress={() => setPasteVisible(true)}
          >
            <ClipboardIcon size={16} color={colors.textSecondary} />
            <Text style={styles.pasteButtonText}>Paste code</Text>
          </Pressable>
        </View>
        <TextInputModal
          visible={pasteVisible}
          title="Paste Orca code"
          message="Copy the pairing code or relay invite from your computer."
          placeholder="orca://pair?code=... or relay invite"
          onSubmit={handlePasteSubmit}
          onCancel={() => setPasteVisible(false)}
        />
      </View>
    )
  }

  return (
    <View ref={setPairScanRootRef} style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>

      <View style={styles.steps}>
        <Step number={1} text="Open Orca on your computer" />
        <Step number={2} text="Go to Settings → Mobile" />
        <Step number={3} text="Scan the Orca QR code" />
      </View>

      {status === 'scanning' && (
        <>
          {/* Why: unmount the camera while the paste sheet is open. The
              user has clearly chosen the paste path; keeping the camera
              streaming behind a sheet wastes power and looks weird if
              they cancel the sheet and the QR was scanned silently in
              the meantime. */}
          {!pasteVisible && (
            <View style={styles.cameraWrap} onLayout={handleCameraLayout}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarCodeScanned}
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
            onPress={() => setPasteVisible(true)}
          >
            <ClipboardIcon size={16} color={colors.textSecondary} />
            <Text style={styles.pasteButtonText}>Paste code or relay invite</Text>
          </Pressable>
          {noticeMessage ? <Text style={styles.noticeText}>{noticeMessage}</Text> : null}
        </>
      )}

      {status === 'connecting' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text style={styles.connectingText}>
            {connectionKind === 'relay' ? 'Connecting through relay...' : 'Connecting...'}
          </Text>
          <View style={styles.logSlot}>
            <ConnectionLog
              entries={logs}
              title={connectionKind === 'relay' ? 'Relay log' : 'Pairing log'}
            />
          </View>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          {logs.length > 0 && (
            <View style={styles.logSlot}>
              <ConnectionLog
                entries={logs}
                title={connectionKind === 'relay' ? 'Relay log' : 'Pairing log'}
              />
            </View>
          )}
          <View style={styles.errorActions}>
            <Pressable style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pasteButtonPressed
              ]}
              onPress={() => {
                retry()
                setPasteVisible(true)
              }}
            >
              <Text style={styles.secondaryButtonText}>Paste code</Text>
            </Pressable>
          </View>
        </View>
      )}

      <TextInputModal
        visible={pasteVisible}
        title="Paste Orca code"
        message="Copy the pairing code or relay invite from your computer."
        placeholder="orca://pair?code=... or relay invite"
        onSubmit={handlePasteSubmit}
        onCancel={() => setPasteVisible(false)}
      />
    </View>
  )
}
