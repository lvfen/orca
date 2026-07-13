import { useCallback, useEffect, useRef, useState } from 'react'
import { Globe2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  CreateInviteResult,
  DesktopRelaySettings,
  DesktopRelayV2Status,
  RelayV2CreatedInvite
} from '@/../../shared/relay-v2-desktop'
import type { ChannelCreateRequiresConfirmationMessage } from '@/../../shared/relay-v2-protocol'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { MobileBindingStatus } from './mobile-relay/MobileBindingStatus'
import { RebindMobileDialog } from './mobile-relay/RebindMobileDialog'
import { RelayInviteQrDialog } from './mobile-relay/RelayInviteQrDialog'
import { RelayServerStatus } from './mobile-relay/RelayServerStatus'
import { RelayUrlSetting } from './mobile-relay/RelayUrlSetting'
import {
  discoveredCertificateErrorMessage,
  relayInviteErrorMessage
} from './mobile-relay/relay-error-messages'

export function MobileRelaySection(): React.JSX.Element {
  const [settings, setSettings] = useState<DesktopRelaySettings | null>(null)
  const [status, setStatus] = useState<DesktopRelayV2Status | null>(null)
  const [relayUrlInput, setRelayUrlInput] = useState('')
  const [accessTokenInput, setAccessTokenInput] = useState('')
  const [certificateTokenInput, setCertificateTokenInput] = useState('')
  const [savingRelayUrl, setSavingRelayUrl] = useState(false)
  const [installingCertificate, setInstallingCertificate] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [invite, setInvite] = useState<RelayV2CreatedInvite | null>(null)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [rebindMobile, setRebindMobile] = useState<ChannelCreateRequiresConfirmationMessage | null>(
    null
  )
  const [rebindDialogOpen, setRebindDialogOpen] = useState(false)
  const [copiedInvite, setCopiedInvite] = useState(false)
  const copiedInviteTimerRef = useRef<number | null>(null)
  const autoCertificateInstallAttemptRef = useRef<string | null>(null)
  const mountedRef = useMountedRef()

  const refreshRelayV2 = useCallback(async () => {
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        window.api.mobileRelayV2.getSettings(),
        window.api.mobileRelayV2.getStatus()
      ])
      if (!mountedRef.current) {
        return
      }
      setSettings(nextSettings)
      setStatus(nextStatus)
      setRelayUrlInput(nextSettings.relayUrl ?? '')
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.mobileRelay.loadFailed',
            'Failed to load relay settings'
          )
        )
      }
    }
  }, [mountedRef])

  useEffect(() => {
    void refreshRelayV2()
    return window.api.mobileRelayV2.onStatusChanged((nextStatus) => {
      if (mountedRef.current) {
        setStatus(nextStatus)
      }
    })
  }, [mountedRef, refreshRelayV2])

  useEffect(
    () => () => {
      if (copiedInviteTimerRef.current !== null) {
        window.clearTimeout(copiedInviteTimerRef.current)
      }
    },
    []
  )

  useEffect(() => {
    const relayUrl = status?.relayUrl
    if (status?.state !== 'certificate-required' || !relayUrl) {
      return
    }
    if (autoCertificateInstallAttemptRef.current === relayUrl) {
      return
    }
    autoCertificateInstallAttemptRef.current = relayUrl
    void installDiscoveredCertificate(relayUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.relayUrl, status?.state])

  async function saveRelayUrl(): Promise<void> {
    const relayUrl = relayUrlInput.trim()
    if (!relayUrl) {
      return
    }
    autoCertificateInstallAttemptRef.current = null
    setSavingRelayUrl(true)
    try {
      const result = await window.api.mobileRelayV2.saveRelayUrl({
        relayUrl,
        accessToken: accessTokenInput.trim() || undefined
      })
      if (!mountedRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          translate('auto.components.settings.mobileRelay.invalidUrl', 'Invalid relay URL')
        )
        setStatus(result.status)
        return
      }
      setSettings(result.settings)
      setStatus(result.status)
      setRelayUrlInput(result.settings.relayUrl ?? '')
      setAccessTokenInput('')
      toast.success(translate('auto.components.settings.mobileRelay.urlSaved', 'Relay URL saved'))
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.settings.mobileRelay.saveFailed', 'Failed to save relay URL')
        )
      }
    } finally {
      if (mountedRef.current) {
        setSavingRelayUrl(false)
      }
    }
  }

  async function clearSettings(): Promise<void> {
    try {
      await window.api.mobileRelayV2.clearSettings()
      if (!mountedRef.current) {
        return
      }
      setSettings(null)
      setStatus(await window.api.mobileRelayV2.getStatus())
      setRelayUrlInput('')
      setAccessTokenInput('')
      setInvite(null)
      autoCertificateInstallAttemptRef.current = null
      toast.success(
        translate('auto.components.settings.mobileRelay.cleared', 'Relay settings cleared')
      )
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.settings.mobileRelay.clearFailed', 'Failed to clear relay')
        )
      }
    }
  }

  async function installDiscoveredCertificate(relayUrl: string): Promise<void> {
    setInstallingCertificate(true)
    try {
      const result = await window.api.mobileRelayV2.installDiscoveredCertificate({ relayUrl })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        if (result.appTrusted) {
          toast.success(
            translate(
              'auto.components.settings.mobileRelay.certificateTrusted',
              'Relay certificate trusted for Orca. Reconnecting...'
            )
          )
          await reconnectRelay(relayUrl)
          return
        }
        toast.success(
          translate(
            'auto.components.settings.mobileRelay.certificateAutoOpened',
            'Certificate installer opened. Complete installation and trust, then connect again.'
          )
        )
        return
      }
      toast.error(discoveredCertificateErrorMessage(result.reason))
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.mobileRelay.certificateAutoFailed',
            'Could not download the relay certificate'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setInstallingCertificate(false)
      }
    }
  }

  async function installCertificateToken(): Promise<void> {
    const token = certificateTokenInput.trim()
    if (!token) {
      return
    }
    setInstallingCertificate(true)
    try {
      const result = await window.api.mobileRelayV2.installCertificateToken({ token })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setCertificateTokenInput('')
        if (result.appTrusted && status?.relayUrl) {
          toast.success(
            translate(
              'auto.components.settings.mobileRelay.certificateTrusted',
              'Relay certificate trusted for Orca. Reconnecting...'
            )
          )
          await reconnectRelay(status.relayUrl)
          return
        }
        toast.success(
          translate(
            'auto.components.settings.mobileRelay.certificateOpened',
            'Certificate installer opened'
          )
        )
      } else {
        toast.error(
          translate(
            'auto.components.settings.mobileRelay.certificateFailed',
            'Failed to open certificate token'
          )
        )
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.mobileRelay.certificateFailed',
            'Failed to open certificate token'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setInstallingCertificate(false)
      }
    }
  }

  async function reconnectRelay(relayUrl: string): Promise<void> {
    const result = await window.api.mobileRelayV2.saveRelayUrl({ relayUrl })
    if (!mountedRef.current) {
      return
    }
    if (!result.ok) {
      setStatus(result.status)
      return
    }
    setSettings(result.settings)
    setStatus(result.status)
    setRelayUrlInput(result.settings.relayUrl ?? '')
  }

  async function createInvite(mode: 'keep-existing' | 'disconnect-existing'): Promise<void> {
    setCreatingInvite(true)
    try {
      const result = await window.api.mobileRelayV2.createInvite({ mode })
      if (!mountedRef.current) {
        return
      }
      handleInviteResult(result)
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate('auto.components.settings.mobileRelay.inviteFailed', 'Failed to create invite')
        )
      }
    } finally {
      if (mountedRef.current) {
        setCreatingInvite(false)
      }
    }
  }

  function handleInviteResult(result: CreateInviteResult): void {
    setStatus(result.status)
    if (result.ok) {
      setInvite(result.invite)
      setInviteDialogOpen(true)
      setRebindDialogOpen(false)
      setRebindMobile(null)
      return
    }
    if (result.reason === 'confirmation-required' && result.existingMobile) {
      setRebindMobile(result.existingMobile)
      setRebindDialogOpen(true)
      return
    }
    toast.error(relayInviteErrorMessage(result.reason))
  }

  async function copyInvite(): Promise<void> {
    if (!invite) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(invite.qrScanPayload ?? invite.qrPayloadJson)
      if (!mountedRef.current) {
        return
      }
      setCopiedInvite(true)
      if (copiedInviteTimerRef.current !== null) {
        window.clearTimeout(copiedInviteTimerRef.current)
      }
      copiedInviteTimerRef.current = window.setTimeout(() => {
        copiedInviteTimerRef.current = null
        if (mountedRef.current) {
          setCopiedInvite(false)
        }
      }, 2000)
    } catch {
      toast.error(
        translate('auto.components.settings.mobileRelay.copyFailed', 'Failed to copy invite')
      )
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Globe2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {translate('auto.components.settings.mobileRelay.title', 'Remote relay')}
          </span>
        </div>

        <div className="space-y-4">
          <RelayUrlSetting
            relayUrlInput={relayUrlInput}
            accessTokenInput={accessTokenInput}
            certificateTokenInput={certificateTokenInput}
            settings={settings}
            status={status}
            saving={savingRelayUrl}
            installingCertificate={installingCertificate}
            onRelayUrlInputChange={setRelayUrlInput}
            onAccessTokenInputChange={setAccessTokenInput}
            onCertificateTokenInputChange={setCertificateTokenInput}
            onSaveRelayUrl={() => void saveRelayUrl()}
            onClearSettings={() => void clearSettings()}
            onInstallCertificate={() => void installCertificateToken()}
          />
          <RelayServerStatus status={status} />
          <MobileBindingStatus
            status={status}
            creatingInvite={creatingInvite}
            onCreateInvite={() => void createInvite('keep-existing')}
          />
        </div>
      </div>

      <RebindMobileDialog
        open={rebindDialogOpen}
        mobile={rebindMobile}
        reconnecting={creatingInvite}
        onOpenChange={setRebindDialogOpen}
        onDisconnectAndRebind={() => void createInvite('disconnect-existing')}
      />
      <RelayInviteQrDialog
        invite={invite}
        open={inviteDialogOpen}
        copied={copiedInvite}
        onOpenChange={setInviteDialogOpen}
        onCopy={() => void copyInvite()}
      />
    </div>
  )
}
