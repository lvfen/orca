import { encodeRelayV2ClientMessage } from '../../../shared/relay-v2-protocol'
import type {
  ChannelCreateRequiresConfirmationMessage,
  ChannelCreatedMessage
} from '../../../shared/relay-v2-protocol'
import type { CreateInviteResult, DesktopRelayV2Status } from '../../../shared/relay-v2-desktop'
import type { WebSocket } from 'ws'

type PendingInvite = {
  resolve: (result: CreateInviteResult) => void
  timer: ReturnType<typeof setTimeout>
}

type InviteFailureReason = Extract<CreateInviteResult, { ok: false }>['reason']

export class RelayV2InviteRequests {
  private pendingInvite: PendingInvite | null = null

  constructor(private readonly inviteTimeoutMs: number) {}

  hasPending(): boolean {
    return this.pendingInvite !== null
  }

  create(
    ws: WebSocket,
    mode: 'keep-existing' | 'disconnect-existing',
    status: DesktopRelayV2Status
  ): Promise<CreateInviteResult> {
    if (this.pendingInvite) {
      return Promise.resolve({ ok: false, reason: 'busy', status })
    }
    return new Promise<CreateInviteResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingInvite = null
        resolve({ ok: false, reason: 'timeout', status })
      }, this.inviteTimeoutMs)
      if (typeof timer.unref === 'function') {
        timer.unref()
      }
      this.pendingInvite = { resolve, timer }
      ws.send(encodeRelayV2ClientMessage({ type: 'channel-create', mode }))
    })
  }

  resolveCreated(message: ChannelCreatedMessage, status: DesktopRelayV2Status): void {
    const pending = this.pendingInvite
    if (!pending) {
      return
    }
    this.pendingInvite = null
    clearTimeout(pending.timer)
    pending.resolve({
      ok: true,
      invite: {
        channelId: message.channelId,
        inviteToken: message.inviteToken,
        expiresAt: message.expiresAt,
        qrPayload: message.qrPayload,
        qrPayloadJson: JSON.stringify(message.qrPayload)
      },
      status
    })
  }

  resolveConfirmationRequired(
    message: ChannelCreateRequiresConfirmationMessage,
    status: DesktopRelayV2Status
  ): void {
    const pending = this.pendingInvite
    if (!pending) {
      return
    }
    this.pendingInvite = null
    clearTimeout(pending.timer)
    pending.resolve({
      ok: false,
      reason: 'confirmation-required',
      existingMobile: message,
      status
    })
  }

  reject(reason: InviteFailureReason, status: DesktopRelayV2Status): void {
    const pending = this.pendingInvite
    if (!pending) {
      return
    }
    this.pendingInvite = null
    clearTimeout(pending.timer)
    pending.resolve({ ok: false, reason, status })
  }
}
