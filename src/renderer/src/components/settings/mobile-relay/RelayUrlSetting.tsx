import { Loader2, PlugZap, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DesktopRelaySettings, DesktopRelayV2Status } from '@/../../shared/relay-v2-desktop'
import { translate } from '@/i18n/i18n'

type Props = {
  relayUrlInput: string
  certificateTokenInput: string
  settings: DesktopRelaySettings | null
  status: DesktopRelayV2Status | null
  saving: boolean
  installingCertificate: boolean
  onRelayUrlInputChange: (value: string) => void
  onCertificateTokenInputChange: (value: string) => void
  onSaveRelayUrl: () => void
  onClearSettings: () => void
  onInstallCertificate: () => void
}

export function RelayUrlSetting({
  relayUrlInput,
  certificateTokenInput,
  settings,
  status,
  saving,
  installingCertificate,
  onRelayUrlInputChange,
  onCertificateTokenInputChange,
  onSaveRelayUrl,
  onClearSettings,
  onInstallCertificate
}: Props): React.JSX.Element {
  const canSave = relayUrlInput.trim().length > 0 && !saving
  const canInstallCertificate = certificateTokenInput.trim().length > 0 && !installingCertificate
  const configured = Boolean(settings?.relayUrl)

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="relay-v2-url">
          {translate('auto.components.settings.mobileRelay.urlLabel', 'Relay address')}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="relay-v2-url"
            value={relayUrlInput}
            onChange={(event) => onRelayUrlInputChange(event.target.value)}
            placeholder={translate(
              'auto.components.settings.mobileRelay.urlPlaceholder',
              'relay.example.com or 49.51.37.225:6770'
            )}
            spellCheck={false}
            autoCapitalize="off"
            className="font-mono text-xs"
          />
          <Button onClick={onSaveRelayUrl} disabled={!canSave} size="sm">
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <PlugZap className="size-3.5" />
            )}
            {translate('auto.components.settings.mobileRelay.connect', 'Connect')}
          </Button>
          {configured && (
            <Button variant="outline" onClick={onClearSettings} size="sm" className="shrink-0">
              <Trash2 className="size-3.5" />
              {translate('auto.components.settings.mobileRelay.clear', 'Clear')}
            </Button>
          )}
        </div>
      </div>

      {status?.state === 'certificate-required' && (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-muted-foreground" />
            {translate(
              'auto.components.settings.mobileRelay.certificateTitle',
              'Local CA certificate'
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {installingCertificate
              ? translate(
                  'auto.components.settings.mobileRelay.certificateAutoOpening',
                  'Opening the relay certificate installer...'
                )
              : translate(
                  'auto.components.settings.mobileRelay.certificateFallback',
                  'If the installer did not open, paste the certificate token below.'
                )}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={certificateTokenInput}
              onChange={(event) => onCertificateTokenInputChange(event.target.value)}
              placeholder={translate(
                'auto.components.settings.mobileRelay.certificatePlaceholder',
                'orca-cert_...'
              )}
              spellCheck={false}
              autoCapitalize="off"
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onInstallCertificate}
              disabled={!canInstallCertificate}
            >
              {installingCertificate ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              {translate('auto.components.settings.mobileRelay.installCertificate', 'Install')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
