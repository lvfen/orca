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
import { useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import {
  RELAY_CERTIFICATE_TOKEN_PREFIX,
  decodeRelayCertificateToken
} from '../src/transport/relay-token'
import type { PairingConnectionAttempt } from '../src/transport/pairing-connection-attempt'
import type { ConnectionLogEntry } from '../src/transport/types'
import { colors, spacing } from '../src/theme/mobile-theme'
import { TextInputModal } from '../src/components/TextInputModal'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { styles } from '../src/relay/add-relay-styles'
import { RelayCameraPermissionScreen } from '../src/relay/relay-camera-permission-screen'
import { RelayTokenEntryScreen } from '../src/relay/relay-token-entry-screen'
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
import { RelayQrScanner } from '../src/relay/relay-qr-scanner'
const SCAN_RETICLE_SCALE = 0.62
const SCAN_RETICLE_MAX_SIZE = 360

type Status = 'enter-token' | 'scanning' | 'certificate-required' | 'connecting' | 'error'

export default function AddRelayScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  // Why: relay v2 pairing is initiated by the PC QR invite; manual token entry
  // is only a fallback for pasted invites/certificates.
  const [status, setStatus] = useState<Status>('scanning')
  const [tokenInput, setTokenInput] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [tokenNotice, setTokenNotice] = useState('')
  const [certificateNotice, setCertificateNotice] = useState('')
  const [certificateError, setCertificateError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const relayV2InviteRef = useRef<RelayInviteV2Payload | null>(null)
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const processingRef = useRef(false)
  const mountedRef = useRef(true)
  const activeAttemptRef = useRef<PairingConnectionAttempt | null>(null)

  const setRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    // Why: a verify attempt can outlive the visible route; dispose it on detach.
    mountedRef.current = false
    activeAttemptRef.current?.dispose()
    activeAttemptRef.current = null
  }, [])

  const openCertificateToken = useCallback(async (token: string): Promise<void> => {
    const result = await openRelayCertificateToken(token)
    if (result === 'invalid') {
      setTokenNotice('')
      setTokenError('Not a valid certificate token')
      return
    }
    if (result === 'opened') {
      setTokenInput('')
      setTokenError('')
      setTokenNotice(
        'Certificate profile opened. Finish installation in Settings, then enable full trust.'
      )
      return
    }
    setTokenNotice('')
    setTokenError('Could not open the certificate profile')
  }, [])

  const handleTokenContinue = useCallback(() => {
    const token = tokenInput.trim()
    if (token.startsWith(RELAY_CERTIFICATE_TOKEN_PREFIX)) {
      void openCertificateToken(token)
      return
    }
    const invite = decodeRelayV2Invite(token)
    if (invite) {
      handleRelayV2Invite(invite)
      return
    }
    setTokenNotice('')
    setTokenError('Not a valid relay invite or certificate token')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCertificateToken, tokenInput])

  function updateTokenInput(value: string): void {
    setTokenInput(value)
    setTokenError('')
    setTokenNotice('')
  }

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (processingRef.current) {
      return
    }
    const invite = decodeRelayV2Invite(data)
    if (invite) {
      processingRef.current = true
      handleRelayV2Invite(invite)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePasteSubmit = useCallback(
    (input: string) => {
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
      if (decodeRelayCertificateToken(trimmed)) {
        void openCertificateToken(trimmed)
        return
      }
      setStatus('error')
      setErrorMessage('Not a valid relay invite — scan the Remote relay QR from your PC')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [openCertificateToken]
  )

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const next = { width: Math.round(width), height: Math.round(height) }
    setCameraBounds((cur) => (cur.width === next.width && cur.height === next.height ? cur : next))
  }, [])

  function handleRelayV2Invite(invite: RelayInviteV2Payload): void {
    relayV2InviteRef.current = invite
    setCertificateNotice('')
    setCertificateError('')
    setTokenError('')
    setTokenNotice('')
    if (invite.serverCaDerB64 !== 'unavailable' && invite.serverCaSha256 !== 'unavailable') {
      setStatus('certificate-required')
      processingRef.current = false
      return
    }
    void testAndSaveV2(invite)
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

  async function testAndSaveV2(invite: RelayInviteV2Payload) {
    setStatus('connecting')
    resetLogs()
    activeAttemptRef.current?.dispose()
    handleFlowResult(await connectAndSaveRelayV2({ invite, hooks: createAttemptHooks() }))
  }

  function createAttemptHooks() {
    return {
      setActiveAttempt: (attempt: PairingConnectionAttempt) => {
        activeAttemptRef.current = attempt
      },
      clearActiveAttempt: (attempt: PairingConnectionAttempt) => {
        if (activeAttemptRef.current === attempt) {
          activeAttemptRef.current = null
        }
      },
      isActiveAttempt: (attempt: PairingConnectionAttempt) => activeAttemptRef.current === attempt,
      isMounted: () => mountedRef.current,
      onLog: (entry: ConnectionLogEntry) => {
        logsRef.current = [...logsRef.current, entry]
        setLogs(logsRef.current)
      }
    }
  }

  function handleFlowResult(result: AddRelayFlowResult): void {
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
    resetLogs()
    processingRef.current = false
  }

  const containerPadding = {
    paddingTop: insets.top + spacing.sm,
    paddingBottom: insets.bottom + spacing.sm
  }
  const reticleSize = Math.min(
    Math.round(Math.min(cameraBounds.width, cameraBounds.height) * SCAN_RETICLE_SCALE),
    SCAN_RETICLE_MAX_SIZE
  )

  // ─── Step 1: scan or paste the relay v2 invite ───
  if (status === 'enter-token') {
    return (
      <View ref={setRootRef} style={styles.routeRoot}>
        <RelayTokenEntryScreen
          containerPadding={containerPadding}
          tokenInput={tokenInput}
          tokenError={tokenError}
          tokenNotice={tokenNotice}
          onTokenInputChange={updateTokenInput}
          onBack={() => router.back()}
          onContinue={handleTokenContinue}
          onScanRelayV2={() => {
            setStatus('scanning')
            setTokenError('')
            setTokenNotice('')
          }}
        />
      </View>
    )
  }

  if (status === 'certificate-required' && relayV2InviteRef.current) {
    return (
      <View ref={setRootRef} style={styles.routeRoot}>
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
          onContinue={() => void testAndSaveV2(relayV2InviteRef.current!)}
        />
      </View>
    )
  }

  if (!permission) {
    return (
      <View ref={setRootRef} style={[styles.container, containerPadding]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false
    return (
      <View ref={setRootRef} style={styles.routeRoot}>
        <RelayCameraPermissionScreen
          containerPadding={containerPadding}
          canAskAgain={canAskAgain}
          pasteVisible={pasteVisible}
          onBack={() => router.back()}
          onRequestPermission={requestPermission}
          onOpenSettings={() => void Linking.openSettings()}
          onShowPaste={() => setPasteVisible(true)}
          onPasteSubmit={handlePasteSubmit}
          onCancelPaste={() => setPasteVisible(false)}
        />
      </View>
    )
  }

  return (
    <View ref={setRootRef} style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>

      {status === 'scanning' && (
        <RelayQrScanner
          pasteVisible={pasteVisible}
          reticleSize={reticleSize}
          onCameraLayout={handleCameraLayout}
          onBarcodeScanned={handleBarCodeScanned}
          onShowPaste={() => setPasteVisible(true)}
          onManualEntry={() => setStatus('enter-token')}
        />
      )}

      {status === 'connecting' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text style={styles.connectingText}>Connecting through relay…</Text>
          <View style={styles.logSlot}>
            <ConnectionLog entries={logs} title="Relay log" />
          </View>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          {logs.length > 0 && (
            <View style={styles.logSlot}>
              <ConnectionLog entries={logs} title="Relay log" />
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
              <Text style={styles.secondaryButtonText}>Paste invite instead</Text>
            </Pressable>
          </View>
        </View>
      )}

      <TextInputModal
        visible={pasteVisible}
        title="Paste Relay Invite"
        message="Copy the Remote relay invite JSON or certificate token from your computer."
        placeholder='{"v":2,"type":"orca-relay-invite",...}'
        onSubmit={handlePasteSubmit}
        onCancel={() => setPasteVisible(false)}
      />
    </View>
  )
}
