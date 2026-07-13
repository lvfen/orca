import { Loader2, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ChannelCreateRequiresConfirmationMessage } from '@/../../shared/relay-v2-protocol'
import { translate } from '@/i18n/i18n'
import { formatLastSeen, mobileStateLabel } from './relay-v2-display'

type Props = {
  open: boolean
  mobile: ChannelCreateRequiresConfirmationMessage | null
  reconnecting: boolean
  onOpenChange: (open: boolean) => void
  onDisconnectAndRebind: () => void
}

export function RebindMobileDialog({
  open,
  mobile,
  reconnecting,
  onOpenChange,
  onDisconnectAndRebind
}: Props): React.JSX.Element {
  return (
    <Dialog open={open && mobile !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.mobileRelay.rebindTitle', 'Phone already bound')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.mobileRelay.rebindDescription',
              'Disconnecting replaces the existing phone binding for this PC.'
            )}
          </DialogDescription>
        </DialogHeader>
        {mobile && (
          <div className="rounded-md border border-border/60 px-3 py-2">
            <div className="truncate text-sm font-medium">{mobile.mobileName}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {mobileStateLabel(mobile.mobileState)} · {formatLastSeen(mobile.lastSeenAt)}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate('auto.components.settings.mobileRelay.keepBinding', 'Keep current')}
          </Button>
          <Button onClick={onDisconnectAndRebind} disabled={reconnecting}>
            {reconnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="size-3.5" />
            )}
            {translate(
              'auto.components.settings.mobileRelay.disconnectRebind',
              'Disconnect & rebind'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
