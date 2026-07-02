import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Globe, Link2Off, Loader2, Maximize2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import type { RelayStatus } from '@/../../shared/relay-protocol'
import { isRelayTerminalState, relayStatusTone, type RelayStatusTone } from './mobile-relay-status'

type ServerTokenInfo = {
  qrDataUrl: string
  publicKeyB64: string
  deviceToken: string
  roomId: string
}

// Why: relay status is polled (no push channel from the host transport), so the
// settings pane keeps it fresh while open without holding a socket of its own.
const STATUS_POLL_MS = 3000

const TONE_DOT: Record<RelayStatusTone, string> = {
  connected: 'bg-emerald-500',
  pending: 'bg-amber-500',
  danger: 'bg-destructive',
  idle: 'bg-muted-foreground/50'
}

function statusLabel(status: RelayStatus): string {
  switch (status.state) {
    case 'connected':
      return translate('auto.components.settings.MobileRelaySection.connected', 'Connected')
    case 'connecting':
      return translate('auto.components.settings.MobileRelaySection.connecting', 'Connecting…')
    case 'reconnecting':
      return translate(
        'auto.components.settings.MobileRelaySection.reconnecting',
        'Reconnecting… (attempt {{attempt}})',
        { attempt: status.attempt }
      )
    case 'occupied':
      return translate('auto.components.settings.MobileRelaySection.occupied', 'Taken over')
    case 'unauthorized':
      return translate(
        'auto.components.settings.MobileRelaySection.unauthorized',
        'Pairing invalid'
      )
    case 'disconnected':
      return translate('auto.components.settings.MobileRelaySection.disconnected', 'Not connected')
  }
}

function terminalMessage(status: RelayStatus): string {
  return status.state === 'occupied'
    ? translate(
        'auto.components.settings.MobileRelaySection.occupiedHint',
        'Connection taken over — this token is in use on another device. Re-pair to reclaim it.'
      )
    : translate(
        'auto.components.settings.MobileRelaySection.unauthorizedHint',
        'Pairing no longer valid — generate a fresh token on the relay and re-pair.'
      )
}

export function MobileRelaySection(): React.JSX.Element {
  const [pcTokenInput, setPcTokenInput] = useState('')
  const [status, setStatus] = useState<RelayStatus | null>(null)
  const [serverToken, setServerToken] = useState<ServerTokenInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [qrEnlarged, setQrEnlarged] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)
  const mountedRef = useMountedRef()

  const refreshStatus = useCallback(async () => {
    try {
      const result = await window.api.mobile.getRelayStatus()
      if (mountedRef.current) {
        setStatus(result.status)
      }
    } catch {
      // Status is advisory; a transient IPC failure shouldn't disrupt the pane.
    }
  }, [mountedRef])

  const refreshServerToken = useCallback(async () => {
    try {
      const result = await window.api.mobile.getRelayServerToken()
      if (mountedRef.current) {
        setServerToken(result.available ? result : null)
      }
    } catch {
      // Leave the last known token in place on transient failure.
    }
  }, [mountedRef])

  useEffect(() => {
    void refreshStatus()
    void refreshServerToken()
    const id = window.setInterval(() => void refreshStatus(), STATUS_POLL_MS)
    return () => window.clearInterval(id)
  }, [refreshStatus, refreshServerToken])

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
    },
    []
  )

  async function handleSave(): Promise<void> {
    const pcToken = pcTokenInput.trim()
    if (!pcToken) {
      return
    }
    setSaving(true)
    try {
      const result = await window.api.mobile.setRelayConfig({ pcToken })
      if (!mountedRef.current) {
        return
      }
      setStatus(result.status)
      if (result.ok) {
        setPcTokenInput('')
        await refreshServerToken()
        toast.success(
          translate('auto.components.settings.MobileRelaySection.saved', 'Relay token saved')
        )
      } else {
        toast.error(
          translate(
            'auto.components.settings.MobileRelaySection.invalidToken',
            'That server token is invalid'
          )
        )
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.MobileRelaySection.saveFailed',
            'Failed to save token'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }

  async function handleClear(): Promise<void> {
    try {
      await window.api.mobile.clearRelayConfig()
      if (!mountedRef.current) {
        return
      }
      setServerToken(null)
      setPcTokenInput('')
      await refreshStatus()
      toast.success(
        translate('auto.components.settings.MobileRelaySection.cleared', 'Relay disconnected')
      )
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.MobileRelaySection.clearFailed',
            'Failed to disconnect'
          )
        )
      }
    }
  }

  async function copyDeviceToken(): Promise<void> {
    if (!serverToken) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(serverToken.deviceToken)
      if (!mountedRef.current) {
        return
      }
      setCopied(true)
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null
        if (mountedRef.current) {
          setCopied(false)
        }
      }, 2000)
    } catch {
      toast.error(
        translate('auto.components.settings.MobileRelaySection.copyFailed', 'Failed to copy token')
      )
    }
  }

  const configured = serverToken !== null
  const tone: RelayStatusTone = status ? relayStatusTone(status.state) : 'idle'
  const terminal = status != null && isRelayTerminalState(status.state)

  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Globe className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {translate(
            'auto.components.settings.MobileRelaySection.title',
            'Server Token (remote bridge)'
          )}
        </span>
      </div>
      <p className="text-muted-foreground mb-3 text-xs">
        {translate(
          'auto.components.settings.MobileRelaySection.description',
          'Connect through a self-hosted relay to reach this computer from anywhere — no inbound port and no shared network. Paste the PC token printed by your relay server.'
        )}
      </p>

      {!configured ? (
        <div className="space-y-2">
          <Input
            value={pcTokenInput}
            onChange={(e) => setPcTokenInput(e.target.value)}
            placeholder={translate(
              'auto.components.settings.MobileRelaySection.placeholder',
              'Paste PC token (orca-pc_…)'
            )}
            className="font-mono text-xs"
            spellCheck={false}
            autoCapitalize="off"
          />
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !pcTokenInput.trim()}
            size="sm"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {translate('auto.components.settings.MobileRelaySection.connect', 'Save & connect')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
              <span className="text-sm font-medium">{status ? statusLabel(status) : ''}</span>
            </div>
            <span className="text-muted-foreground text-xs">
              {status?.phoneOnline
                ? translate(
                    'auto.components.settings.MobileRelaySection.phoneOnline',
                    'Phone online'
                  )
                : translate(
                    'auto.components.settings.MobileRelaySection.phoneOffline',
                    'Waiting for phone'
                  )}
            </span>
          </div>

          {terminal && status && (
            <p className="text-destructive text-xs">{terminalMessage(status)}</p>
          )}

          <div className="flex flex-col items-center gap-3 rounded-lg border border-border/60 py-5">
            <button
              type="button"
              onClick={() => setQrEnlarged(true)}
              className="group relative cursor-pointer rounded-lg border border-border/60 bg-white p-3"
            >
              <img
                src={serverToken.qrDataUrl}
                alt={translate(
                  'auto.components.settings.MobileRelaySection.qrAlt',
                  'Server Token QR for the Orca mobile app'
                )}
                className="size-44"
              />
              <Maximize2 className="absolute top-1.5 right-1.5 size-3 text-black/30 can-hover:opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <p className="text-muted-foreground max-w-xs text-center text-xs">
              {translate(
                'auto.components.settings.MobileRelaySection.qrCaption',
                'Scan this in the Orca mobile app after pasting its mobile token. It carries this computer’s identity so the relay can never impersonate it.'
              )}
            </p>
            <div className="flex w-full max-w-sm flex-col gap-1.5 px-4">
              <span className="text-muted-foreground text-center text-xs">
                {translate('auto.components.settings.MobileRelaySection.room', 'Room')}:{' '}
                <span className="font-mono">{serverToken.roomId}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyDeviceToken()}
                className="font-mono text-[11px] leading-tight whitespace-normal break-all h-auto py-2 px-3"
              >
                <span className="flex-1 text-left">{serverToken.deviceToken}</span>
                {copied ? (
                  <Check className="ml-2 size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Copy className="ml-2 size-3.5 shrink-0" />
                )}
              </Button>
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={() => void handleClear()} className="gap-1.5">
            <Link2Off className="size-3.5" />
            {translate(
              'auto.components.settings.MobileRelaySection.repair',
              'Disconnect / re-pair'
            )}
          </Button>
        </div>
      )}

      {serverToken && (
        <Dialog open={qrEnlarged} onOpenChange={setQrEnlarged}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {translate(
                  'auto.components.settings.MobileRelaySection.qrDialogTitle',
                  'Scan with Orca Mobile'
                )}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-4">
                <img
                  src={serverToken.qrDataUrl}
                  alt={translate(
                    'auto.components.settings.MobileRelaySection.qrAlt',
                    'Server Token QR for the Orca mobile app'
                  )}
                  className="size-72"
                />
              </div>
              <span className="text-muted-foreground font-mono text-xs">{serverToken.roomId}</span>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
