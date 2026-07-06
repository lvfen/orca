import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { RelayV2CreatedInvite } from '@/../../shared/relay-v2-desktop'
import { translate } from '@/i18n/i18n'

type Props = {
  invite: RelayV2CreatedInvite | null
  open: boolean
  copied: boolean
  onOpenChange: (open: boolean) => void
  onCopy: () => void
}

export function RelayInviteQrDialog({
  invite,
  open,
  copied,
  onOpenChange,
  onCopy
}: Props): React.JSX.Element {
  return (
    <Dialog open={open && invite !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.mobileRelay.qrTitle', 'Scan with Orca Mobile')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.mobileRelay.qrDescription',
              'This invite is tied to the current PC connection.'
            )}
          </DialogDescription>
        </DialogHeader>
        {invite && (
          <div className="flex flex-col items-center gap-3">
            {invite.qrDataUrl ? (
              <div className="rounded-lg bg-white p-4">
                <img
                  src={invite.qrDataUrl}
                  alt={translate(
                    'auto.components.settings.mobileRelay.qrAlt',
                    'Relay invite QR for Orca Mobile'
                  )}
                  className="size-80 max-h-[70vh] max-w-full"
                />
              </div>
            ) : (
              <div className="max-h-48 w-full overflow-auto rounded-md border border-border/60 p-3 font-mono text-xs">
                {invite.qrScanPayload ?? invite.qrPayloadJson}
              </div>
            )}
            <div className="w-full rounded-md border border-border/60 px-3 py-2">
              <div className="text-xs text-muted-foreground">
                {translate('auto.components.settings.mobileRelay.channel', 'Channel')}
              </div>
              <div className="truncate font-mono text-xs">{invite.channelId}</div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCopy} disabled={!invite}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {translate('auto.components.settings.mobileRelay.copyInvite', 'Copy invite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
