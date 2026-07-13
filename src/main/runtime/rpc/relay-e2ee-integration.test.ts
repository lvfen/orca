import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import {
  deriveSharedKey,
  encrypt,
  decrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64
} from '../../../shared/e2ee-crypto'
import { RelayCloseCode } from '../../../shared/relay-protocol'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrcaRuntimeRpcServer } from '../runtime-rpc'

// Why: a relay stand-in that implements both join roles AND the dumb-pipe
// forwarding + lifecycle coupling of the real server, so the desktop relay
// transport, the E2EE channel, and a simulated phone exercise one real tunnel.
class PipeRelay {
  private wss: WebSocketServer | null = null
  port = 0
  private host: WebSocket | null = null
  private client: WebSocket | null = null

  async start(): Promise<void> {
    const wss = new WebSocketServer({ port: 0 })
    this.wss = wss
    await new Promise<void>((resolve) => wss.once('listening', resolve))
    this.port = (wss.address() as AddressInfo).port
    wss.on('connection', (socket) => {
      let joined = false
      let role: 'host' | 'client' | null = null
      socket.on('message', (data, isBinary) => {
        if (!joined && !isBinary) {
          const frame = tryParse(data.toString())
          if (frame?.type === 'host-join') {
            joined = true
            role = 'host'
            this.host = socket
            socket.send(JSON.stringify({ type: 'host-join-ack' }))
            this.pairIfReady()
            return
          }
          if (frame?.type === 'client-join') {
            joined = true
            role = 'client'
            this.client = socket
            this.pairIfReady()
            return
          }
        }
        const peer = role === 'host' ? this.client : this.host
        if (peer && peer.readyState === peer.OPEN) {
          peer.send(data, { binary: isBinary })
        }
      })
      socket.on('close', () => {
        // Lifecycle coupling: one side dropping recycles the other (4408).
        if (role === 'host') {
          this.host = null
          this.client?.close(RelayCloseCode.PeerRecycled, 'peer-recycled')
        } else if (role === 'client') {
          this.client = null
          this.host?.close(RelayCloseCode.PeerRecycled, 'peer-recycled')
        }
      })
    })
  }

  private pairIfReady(): void {
    if (this.host && this.client) {
      this.client.send(JSON.stringify({ type: 'room-ready' }))
      this.host.send(JSON.stringify({ type: 'peer-online' }))
    }
  }

  async stop(): Promise<void> {
    this.host?.terminate()
    this.client?.terminate()
    const wss = this.wss
    this.wss = null
    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    }
  }
}

function tryParse(raw: string): { type?: string; token?: string } | null {
  try {
    return JSON.parse(raw) as { type?: string; token?: string }
  } catch {
    return null
  }
}

const PLAINTEXT_CONTROL = new Set(['room-ready', 'peer-online', 'host-offline', 'e2ee_ready'])

// Why: minimal phone — runs the client side of the relay pre-handshake and the
// full E2EE handshake against the desktop, then issues an encrypted RPC.
class SimulatedPhone {
  private ws: WebSocket | null = null
  private readonly inbox: string[] = []
  private sharedKey: Uint8Array | null = null
  private readonly keys = generateKeyPair()

  async connect(relayUrl: string, mobileToken: string): Promise<void> {
    const ws = new WebSocket(relayUrl)
    this.ws = ws
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        this.inbox.push(data.toString())
      }
    })
    await new Promise<void>((resolve) => ws.once('open', resolve))
    ws.send(JSON.stringify({ type: 'client-join', token: mobileToken }))
  }

  async handshake(desktopPublicKeyB64: string, deviceToken: string): Promise<void> {
    await this.take((s) => isControl(s, 'room-ready'))
    this.send(
      JSON.stringify({ type: 'e2ee_hello', publicKeyB64: publicKeyToBase64(this.keys.publicKey) })
    )
    await this.take((s) => isControl(s, 'e2ee_ready'))
    this.sharedKey = deriveSharedKey(this.keys.secretKey, publicKeyFromBase64(desktopPublicKeyB64))
    this.send(encrypt(JSON.stringify({ type: 'e2ee_auth', deviceToken }), this.sharedKey))
    const ack = await this.takeEncrypted()
    if (ack.type !== 'e2ee_authenticated') {
      throw new Error(`expected e2ee_authenticated, got ${JSON.stringify(ack)}`)
    }
  }

  async rpc(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.send(encrypt(JSON.stringify(request), this.sharedKey!))
    return this.takeEncrypted()
  }

  close(): void {
    this.ws?.close()
  }

  private send(payload: string): void {
    this.ws!.send(payload)
  }

  private async takeEncrypted(): Promise<Record<string, unknown>> {
    const frame = await this.take((s) => !isPlaintextControl(s))
    const plain = decrypt(frame, this.sharedKey!)
    if (plain === null) {
      throw new Error('phone failed to decrypt a frame')
    }
    return JSON.parse(plain) as Record<string, unknown>
  }

  private async take(predicate: (s: string) => boolean, timeoutMs = 3_000): Promise<string> {
    const start = Date.now()
    for (;;) {
      const index = this.inbox.findIndex(predicate)
      if (index >= 0) {
        return this.inbox.splice(index, 1)[0]!
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error('phone timed out waiting for a frame')
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

function isControl(raw: string, type: string): boolean {
  return tryParse(raw)?.type === type
}

function isPlaintextControl(raw: string): boolean {
  const type = tryParse(raw)?.type
  return typeof type === 'string' && PLAINTEXT_CONTROL.has(type)
}

function makePcToken(port: number): string {
  const payload = { relayUrl: `ws://127.0.0.1:${port}`, roomId: 'room-1', secret: 's3cret' }
  return `orca-pc_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

async function until(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not met within timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

let relay: PipeRelay
let server: OrcaRuntimeRpcServer | null = null

afterEach(async () => {
  if (server) {
    await server.stop()
    server = null
  }
  await relay.stop()
})

describe('relay E2EE tunnel (desktop ↔ relay ↔ phone)', () => {
  it('completes an encrypted RPC over the relay and reclaims the channel on reconnect', async () => {
    relay = new PipeRelay()
    await relay.start()

    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-relay-e2ee-'))
    const runtime = new OrcaRuntimeService()
    server = new OrcaRuntimeRpcServer({ runtime, userDataPath, enableWebSocket: false })
    await server.start()

    const status = await server.setRelayConfig(makePcToken(relay.port))
    expect(status.state).not.toBe('unauthorized')
    await until(() => server!.getRelayStatus().state === 'connected')

    const pairing = server.getRelayPairingInfo()
    expect(pairing.available).toBe(true)
    if (!pairing.available) {
      throw new Error('relay pairing info unavailable')
    }

    const phone = new SimulatedPhone()
    await phone.connect(`ws://127.0.0.1:${relay.port}`, 'orca-mb_mobile-token')
    await phone.handshake(pairing.publicKeyB64, pairing.deviceToken)

    const response = await phone.rpc({
      id: 'rpc-1',
      method: 'status.get',
      deviceToken: pairing.deviceToken
    })
    expect(response).toMatchObject({ id: 'rpc-1', ok: true })
    expect((response.result as { graphStatus: string }).graphStatus).toBe('unavailable')

    const channels = server['e2eeChannels'] as Map<unknown, unknown>
    expect(channels.size).toBe(1)

    // Drop the phone: the relay recycles the host socket (4408) and the desktop
    // reconnects with a fresh socket — the old E2EEChannel must be reclaimed.
    phone.close()
    await until(() => channels.size === 0)
    await until(() => server!.getRelayStatus().state === 'connected')

    const phone2 = new SimulatedPhone()
    await phone2.connect(`ws://127.0.0.1:${relay.port}`, 'orca-mb_mobile-token')
    await phone2.handshake(pairing.publicKeyB64, pairing.deviceToken)
    const response2 = await phone2.rpc({
      id: 'rpc-2',
      method: 'status.get',
      deviceToken: pairing.deviceToken
    })
    expect(response2).toMatchObject({ id: 'rpc-2', ok: true })
    // Exactly one live channel — the reconnect built a fresh one, old reclaimed.
    expect(channels.size).toBe(1)
  })
})
