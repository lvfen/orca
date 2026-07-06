import { Loader2, Phone, QrCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DesktopRelayV2Status } from '@/../../shared/relay-v2-desktop'
import { translate } from '@/i18n/i18n'
import { mobileSummaryLabel } from './relay-v2-display'

type Props = {
  status: DesktopRelayV2Status | null
  creatingInvite: boolean
  onCreateInvite: () => void
}

export function MobileBindingStatus({
  status,
  creatingInvite,
  onCreateInvite
}: Props): React.JSX.Element {
  const canCreateInvite = status?.state === 'connected' && !creatingInvite

  return (
    <div className="rounded-md border border-border/60 px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="size-3.5" />
            {translate('auto.components.settings.mobileRelay.mobile', 'Phone')}
          </div>
          <div className="mt-1 truncate text-sm font-medium">
            {mobileSummaryLabel(status?.mobile ?? null)}
          </div>
        </div>
        <Button size="sm" onClick={onCreateInvite} disabled={!canCreateInvite}>
          {creatingInvite ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <QrCode className="size-3.5" />
          )}
          {translate('auto.components.settings.mobileRelay.bindPhone', 'Bind phone')}
        </Button>
      </div>
    </div>
  )
}
