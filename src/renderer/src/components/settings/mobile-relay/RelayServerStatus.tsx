import { Monitor, Server } from 'lucide-react'
import type { DesktopRelayV2Status } from '@/../../shared/relay-v2-desktop'
import { translate } from '@/i18n/i18n'
import { relayV2StatusLabel, relayV2Tone, type RelayV2Tone } from './relay-v2-display'

const TONE_DOT: Record<RelayV2Tone, string> = {
  connected: 'bg-primary',
  pending: 'bg-muted-foreground',
  danger: 'bg-destructive',
  idle: 'bg-border'
}

type Props = {
  status: DesktopRelayV2Status | null
}

export function RelayServerStatus({ status }: Props): React.JSX.Element {
  const tone = status ? relayV2Tone(status.state) : 'idle'

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-md border border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Server className="size-3.5" />
          {translate('auto.components.settings.mobileRelay.server', 'Relay server')}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
          <span className="text-sm font-medium">
            {status
              ? relayV2StatusLabel(status)
              : translate('auto.components.settings.mobileRelay.loading', 'Loading')}
          </span>
        </div>
        {status?.relayUrl && (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {status.relayUrl}
          </div>
        )}
      </div>

      <div className="rounded-md border border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Monitor className="size-3.5" />
          {translate('auto.components.settings.mobileRelay.pc', 'Current PC')}
        </div>
        <div className="mt-1 truncate text-sm font-medium">
          {status?.pcName ??
            translate('auto.components.settings.mobileRelay.pcUnknown', 'Not registered')}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {status?.pcId ?? translate('auto.components.settings.mobileRelay.pcNoId', 'No PC id')}
        </div>
      </div>
    </div>
  )
}
