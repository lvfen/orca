import { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  type LayoutChangeEvent
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { ChevronLeft, Clipboard as ClipboardIcon, QrCode } from 'lucide-react-native'
import { connect } from '../src/transport/rpc-client'
import { saveHost, getNextHostName } from '../src/transport/host-store'
import {
  decodeMobileToken,
  decodeRelayServerToken,
  type RelayTokenPayload,
  type RelayServerToken
} from '../src/transport/relay-token'
import {
  startPairingConnectionAttempt,
  type PairingConnectionAttempt
} from '../src/transport/pairing-connection-attempt'
import type { ConnectionLogEntry, RpcResponse } from '../src/transport/types'
import { colors, spacing } from '../src/theme/mobile-theme'
import { TextInputModal } from '../src/components/TextInputModal'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { styles } from '../src/relay/add-relay-styles'

// Why: relay handshake adds a room-join round-trip on top of the E2EE flow and
// the host may still be connecting to the relay, so allow a touch more time
// than direct LAN pairing before surfacing the diagnostic log.
const RELAY_OVERALL_TIMEOUT_MS = 30_000
const SCAN_RETICLE_SCALE = 0.62
const SCAN_RETICLE_MAX_SIZE = 360

type Status = 'enter-token' | 'scanning' | 'connecting' | 'error'

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

export default function AddRelayScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [status, setStatus] = useState<Status>('enter-token')
  const [tokenInput, setTokenInput] = useState('')
  const [tokenError, setTokenError] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const relayRef = useRef<RelayTokenPayload | null>(null)
  const mobileTokenRef = useRef('')
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

  const handleTokenContinue = useCallback(() => {
    const decoded = decodeMobileToken(tokenInput.trim())
    if (!decoded) {
      setTokenError('Not a valid server token — copy the mobile token from your PC')
      return
    }
    relayRef.current = decoded
    mobileTokenRef.current = tokenInput.trim()
    setTokenError('')
    setStatus('scanning')
  }, [tokenInput])

  const handleBarCodeScanned = useCallback(({ data }: { data: string }) => {
    if (processingRef.current) {
      return
    }
    const server = decodeRelayServerToken(data)
    if (!server) {
      return
    }
    processingRef.current = true
    void testAndSave(server)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePasteSubmit = useCallback((input: string) => {
    setPasteVisible(false)
    if (processingRef.current) {
      return
    }
    const server = decodeRelayServerToken(input.trim())
    if (!server) {
      setStatus('error')
      setErrorMessage('Not a valid Server Token QR — copy it from Orca on your PC')
      return
    }
    processingRef.current = true
    void testAndSave(server)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const next = { width: Math.round(width), height: Math.round(height) }
    setCameraBounds((cur) => (cur.width === next.width && cur.height === next.height ? cur : next))
  }, [])

  async function testAndSave(server: RelayServerToken) {
    const relay = relayRef.current
    const mobileToken = mobileTokenRef.current
    if (!relay || !mobileToken) {
      setStatus('enter-token')
      return
    }
    setStatus('connecting')
    logsRef.current = []
    setLogs([])
    let client: ReturnType<typeof connect> | null = null
    activeAttemptRef.current?.dispose()

    let response: RpcResponse
    const attempt = startPairingConnectionAttempt({
      timeoutMs: RELAY_OVERALL_TIMEOUT_MS,
      closeClient: () => client?.close()
    })
    activeAttemptRef.current = attempt
    try {
      client = connect(relay.relayUrl, server.deviceToken, server.publicKeyB64, {
        relay: { mobileToken },
        onLog: (entry) => {
          if (!mountedRef.current || activeAttemptRef.current !== attempt) {
            return
          }
          logsRef.current = [...logsRef.current, entry]
          setLogs(logsRef.current)
        }
      })
      response = await client.sendRequest('status.get')
      const isCurrent = activeAttemptRef.current === attempt
      attempt.dispose()
      if (activeAttemptRef.current === attempt) {
        activeAttemptRef.current = null
      }
      if (!mountedRef.current || !isCurrent) {
        return
      }
    } catch (err) {
      const timedOut = attempt.timedOut
      const isCurrent = activeAttemptRef.current === attempt
      attempt.dispose()
      if (activeAttemptRef.current === attempt) {
        activeAttemptRef.current = null
      }
      if (!mountedRef.current || !isCurrent) {
        return
      }
      console.warn('[relay] connect failed', err)
      setStatus('error')
      setErrorMessage(
        timedOut
          ? `Couldn't reach your PC through the relay within ${RELAY_OVERALL_TIMEOUT_MS / 1000}s — is the desktop online? See log below.`
          : 'Cannot connect through the relay — check the token and that your PC is online'
      )
      processingRef.current = false
      return
    }

    if (!response.ok) {
      if (!mountedRef.current) {
        return
      }
      setStatus('error')
      setErrorMessage(
        response.error.code === 'unauthorized'
          ? 'Authentication failed — re-pair on the PC and try again'
          : `Server error: ${response.error.message}`
      )
      processingRef.current = false
      return
    }

    try {
      const hostId = `host-${Date.now()}`
      const hostName = await getNextHostName()
      await saveHost({
        id: hostId,
        name: hostName,
        // Why: for relay hosts the endpoint IS the relay URL — connect() dials
        // it and the mobileToken claims the room before the E2EE flow.
        endpoint: relay.relayUrl,
        deviceToken: server.deviceToken,
        publicKeyB64: server.publicKeyB64,
        lastConnected: Date.now(),
        kind: 'relay',
        mobileToken,
        roomId: relay.roomId
      })
      if (!mountedRef.current) {
        return
      }
      router.replace(`/h/${hostId}`)
    } catch (err) {
      if (!mountedRef.current) {
        return
      }
      console.warn('[relay] save failed', err)
      setStatus('error')
      setErrorMessage(
        `Connected but couldn't save the host: ${err instanceof Error ? err.message : String(err)}`
      )
      processingRef.current = false
    }
  }

  function retry() {
    setStatus('scanning')
    setErrorMessage('')
    logsRef.current = []
    setLogs([])
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

  // ─── Step 1: paste the mobile (server) token ───
  if (status === 'enter-token') {
    return (
      <View ref={setRootRef} style={[styles.container, containerPadding]}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.steps}>
          <Step number={1} text="On your PC: Settings → Mobile → Server Token" />
          <Step number={2} text="Copy the mobile token and paste it below" />
          <Step number={3} text="Then scan the Server Token QR" />
        </View>
        <Text style={styles.fieldLabel}>Mobile token</Text>
        <TextInput
          style={styles.tokenField}
          value={tokenInput}
          onChangeText={setTokenInput}
          placeholder="orca-mb_…"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          textAlignVertical="top"
        />
        {tokenError ? <Text style={styles.inlineError}>{tokenError}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            styles.fullWidthButton,
            (pressed || tokenInput.trim().length === 0) && styles.primaryButtonDim
          ]}
          disabled={tokenInput.trim().length === 0}
          onPress={handleTokenContinue}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
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
      <View ref={setRootRef} style={[styles.container, containerPadding]}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.centered}>
          <Text style={styles.title}>
            {canAskAgain ? 'Scan Server Token' : 'Camera Access Disabled'}
          </Text>
          <Text style={styles.subtitle}>
            {canAskAgain
              ? 'Scan the Server Token QR from Orca on your desktop, or paste it instead.'
              : 'Enable camera access in Settings, or paste the Server Token instead.'}
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
            <Text style={styles.pasteButtonText}>Paste token instead</Text>
          </Pressable>
        </View>
        <TextInputModal
          visible={pasteVisible}
          title="Paste Server Token"
          message="Copy the Server Token shown under the QR on your computer."
          placeholder='{"v":1,"publicKeyB64":"…","deviceToken":"…"}'
          onSubmit={handlePasteSubmit}
          onCancel={() => setPasteVisible(false)}
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
        <>
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
            <Text style={styles.pasteButtonText}>Or paste Server Token</Text>
          </Pressable>
        </>
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
              <Text style={styles.secondaryButtonText}>Paste token instead</Text>
            </Pressable>
          </View>
        </View>
      )}

      <TextInputModal
        visible={pasteVisible}
        title="Paste Server Token"
        message="Copy the Server Token shown under the QR on your computer."
        placeholder='{"v":1,"publicKeyB64":"…","deviceToken":"…"}'
        onSubmit={handlePasteSubmit}
        onCancel={() => setPasteVisible(false)}
      />
    </View>
  )
}
