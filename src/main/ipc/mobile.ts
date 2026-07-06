import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import QRCode from 'qrcode'
import { decodeRelayCertificateToken } from '../../shared/relay-certificate-token'
import type { DesktopRelayV2Status } from '../../shared/relay-v2-desktop'
import { encodeRelayV2InviteQrPayload } from '../../shared/relay-v2-invite-qr'
import type { RuntimeAccessGrant } from '../../shared/runtime-access-grants'
import { isTailnetIPv4Address } from '../../shared/tailnet-address'
import type { DeviceEntry } from '../runtime/device-registry'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { discoverRelayCertificateToken } from './relay-certificate-discovery'

export type NetworkInterface = {
  name: string
  address: string
}

const execFileAsync = promisify(execFile)

// Why: the WebSocket transport advertises 0.0.0.0 as its endpoint, which isn't
// connectable from a mobile device. We enumerate all non-internal IPv4
// addresses so the user can choose which one to advertise in the QR code
// (e.g. LAN vs Tailscale).
function getNetworkInterfaces(): NetworkInterface[] {
  const result: NetworkInterface[] = []
  const interfaces = networkInterfaces()
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) {
      continue
    }
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, address: addr.address })
      }
    }
  }
  return result.sort(
    (a, b) => Number(isTailnetIPv4Address(b.address)) - Number(isTailnetIPv4Address(a.address))
  )
}

function getDefaultPairingAddress(): string | null {
  const ifaces = getNetworkInterfaces()
  return ifaces.length > 0 ? ifaces[0]!.address : null
}

function toRuntimeAccessGrant(device: DeviceEntry): RuntimeAccessGrant {
  return {
    deviceId: device.deviceId,
    name: device.name,
    createdAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt > 0 ? device.lastSeenAt : null
  }
}

// Why: the mobile IPC handlers provide the renderer with QR code pairing data,
// device management, and WebSocket readiness status. They depend on the
// OrcaRuntimeRpcServer because it owns the device registry and TLS state.

export function registerMobileHandlers(rpcServer: OrcaRuntimeRpcServer): void {
  const relayV2StatusChange = getRelayV2StatusChangeSource(rpcServer)
  if (relayV2StatusChange) {
    relayV2StatusChange((status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('mobile:v2:statusChanged', status)
      }
    })
  }

  ipcMain.handle('mobile:listNetworkInterfaces', (): { interfaces: NetworkInterface[] } => ({
    interfaces: getNetworkInterfaces()
  }))

  ipcMain.handle(
    'mobile:getPairingQR',
    async (_event, args?: { address?: string; rotate?: boolean }) => {
      // Why: allow the caller to specify which network interface address to
      // embed in the QR code. This supports overlay networks (Tailscale,
      // ZeroTier) where the default LAN IP isn't reachable from the phone.
      const ip = args?.address ?? getDefaultPairingAddress()
      if (!ip) {
        return { available: false as const }
      }

      // Why: coalesce repeated QR regenerations onto a single never-scanned
      // pending token so the copy-button flow doesn't accumulate orphaned
      // device credentials forever. The token graduates to a real entry when
      // a phone actually connects (lastSeenAt > 0). When the caller passes
      // `rotate: true` (explicit "Regenerate" intent because the prior token
      // may have been exposed), we discard any pending token and mint a fresh
      // one so the new QR carries a different credential.
      const offer = rpcServer.createPairingOffer({
        address: ip,
        rotate: args?.rotate,
        name: `Mobile ${new Date().toLocaleDateString()}`,
        scope: 'mobile'
      })
      if (!offer.available) {
        return { available: false as const }
      }

      const qrDataUrl = await QRCode.toDataURL(offer.pairingUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 256
      })

      return {
        available: true as const,
        qrDataUrl,
        pairingUrl: offer.pairingUrl,
        endpoint: offer.endpoint,
        deviceId: offer.deviceId
      }
    }
  )

  ipcMain.handle(
    'mobile:getRuntimePairingUrl',
    async (_event, args?: { address?: string; rotate?: boolean }) => {
      const ip = args?.address ?? getDefaultPairingAddress()
      if (!ip) {
        return { available: false as const }
      }

      // Why: web/desktop runtime clients need full runtime access, not the
      // mobile allowlist used by phone QR pairing.
      const offer = rpcServer.createPairingOffer({
        address: ip,
        rotate: args?.rotate,
        name: `Runtime ${new Date().toLocaleDateString()}`,
        scope: 'runtime'
      })
      if (!offer.available) {
        return { available: false as const }
      }

      return {
        available: true as const,
        pairingUrl: offer.pairingUrl,
        webClientUrl: offer.webClientUrl,
        endpoint: offer.endpoint,
        deviceId: offer.deviceId
      }
    }
  )

  ipcMain.handle('mobile:listDevices', () => {
    const registry = rpcServer.getDeviceRegistry()
    if (!registry) {
      return { devices: [] }
    }
    // Why: devices with lastSeenAt === 0 were created during QR generation
    // but never actually scanned/connected. Showing them as "paired" is
    // misleading, so we filter them out.
    return {
      devices: registry
        .listDevices()
        .filter((d) => d.scope === 'mobile' && d.lastSeenAt > 0)
        .map((d) => ({
          deviceId: d.deviceId,
          name: d.name,
          pairedAt: d.pairedAt,
          lastSeenAt: d.lastSeenAt
        }))
    }
  })

  ipcMain.handle('mobile:listRuntimeAccessGrants', () => {
    const registry = rpcServer.getDeviceRegistry()
    if (!registry) {
      return { grants: [] }
    }
    // Why: generated web/runtime links are bearer credentials even before a
    // client first connects, so pending runtime grants must stay revocable.
    return {
      grants: registry
        .listDevices()
        .filter((d) => d.scope === 'runtime')
        .sort((a, b) => b.pairedAt - a.pairedAt)
        .map(toRuntimeAccessGrant)
    }
  })

  ipcMain.handle('mobile:revokeDevice', (_event, args: { deviceId: string }) => {
    const registry = rpcServer.getDeviceRegistry()
    if (!registry) {
      return { revoked: false }
    }
    return { revoked: rpcServer.revokeMobileDevice(args.deviceId) }
  })

  ipcMain.handle('mobile:revokeRuntimeAccess', (_event, args: { deviceId: string }) => {
    const registry = rpcServer.getDeviceRegistry()
    if (!registry) {
      return { revoked: false }
    }
    return { revoked: rpcServer.revokeRuntimeAccess(args.deviceId) }
  })

  ipcMain.handle('mobile:isWebSocketReady', () => {
    return {
      ready: rpcServer.getWebSocketEndpoint() !== null,
      endpoint: rpcServer.getWebSocketEndpoint()
    }
  })

  ipcMain.handle('mobile:v2:getSettings', () => rpcServer.getRelayV2Settings())

  ipcMain.handle('mobile:v2:saveRelayUrl', async (_event, args: { relayUrl: string }) => {
    const relayUrl = typeof args?.relayUrl === 'string' ? args.relayUrl.trim() : ''
    return rpcServer.saveRelayV2Url(relayUrl)
  })

  ipcMain.handle('mobile:v2:clearSettings', async () => {
    await rpcServer.clearRelayV2Settings()
    return { ok: true as const }
  })

  ipcMain.handle('mobile:v2:getStatus', () => rpcServer.getRelayV2Status())

  ipcMain.handle(
    'mobile:v2:createInvite',
    async (_event, args: { mode: 'keep-existing' | 'disconnect-existing' }) => {
      const mode = args?.mode === 'disconnect-existing' ? 'disconnect-existing' : 'keep-existing'
      const result = await rpcServer.createRelayV2Invite(mode)
      if (!result.ok) {
        return result
      }
      const qrScanPayload = encodeRelayV2InviteQrPayload(result.invite.qrPayload)
      const qrDataUrl = await QRCode.toDataURL(qrScanPayload, {
        errorCorrectionLevel: 'L',
        margin: 3,
        width: 360
      })
      return {
        ...result,
        invite: {
          ...result.invite,
          qrScanPayload,
          qrDataUrl
        }
      }
    }
  )

  ipcMain.handle('mobile:v2:installCertificateToken', async (_event, args: { token: string }) => {
    return installRelayCertificateToken(args, rpcServer)
  })

  ipcMain.handle(
    'mobile:v2:installDiscoveredCertificate',
    async (_event, args: { relayUrl: string }) => {
      const relayUrl = typeof args?.relayUrl === 'string' ? args.relayUrl.trim() : ''
      const discovery = await discoverRelayCertificateToken(relayUrl)
      if (!discovery.ok) {
        return discovery
      }
      return installRelayCertificateToken({ token: discovery.token }, rpcServer)
    }
  )
}

function getRelayV2StatusChangeSource(
  rpcServer: OrcaRuntimeRpcServer
): ((listener: (status: DesktopRelayV2Status) => void) => () => void) | null {
  const candidate = rpcServer as unknown as {
    onRelayV2StatusChange?: (listener: (status: DesktopRelayV2Status) => void) => () => void
  }
  return typeof candidate.onRelayV2StatusChange === 'function'
    ? candidate.onRelayV2StatusChange.bind(rpcServer)
    : null
}

async function installRelayCertificateToken(
  args: { token: string },
  rpcServer: OrcaRuntimeRpcServer
) {
  const token = typeof args?.token === 'string' ? args.token.trim() : ''
  const certificate = decodeRelayCertificateToken(token)
  if (!certificate) {
    return { ok: false as const, reason: 'invalid-token' as const }
  }
  const caCertDer = Buffer.from(certificate.caCertDerB64, 'base64')
  const digest = createHash('sha256').update(caCertDer).digest('base64')
  if (digest !== certificate.sha256B64) {
    return { ok: false as const, reason: 'hash-mismatch' as const }
  }
  const dir = join(app.getPath('temp'), 'orca-relay-certificates')
  await mkdir(dir, { recursive: true })
  const fileName = `${safeCertificateFileStem(certificate.name)}.cer`
  const filePath = join(dir, fileName)
  await writeFile(filePath, caCertDer)
  const appTrusted = await rpcServer.trustRelayV2Certificate(certificate)
  if (process.platform === 'darwin') {
    const systemInstalled = await installCertificateInMacLoginKeychain(filePath)
    if (systemInstalled || appTrusted) {
      return { ok: true as const, filePath, installed: systemInstalled, appTrusted }
    }
    return { ok: false as const, reason: 'open-failed' as const }
  }
  const errorMessage = await shell.openPath(filePath)
  if (!errorMessage || appTrusted) {
    return { ok: true as const, filePath, installed: !errorMessage, appTrusted }
  }
  return { ok: false as const, reason: 'open-failed' as const }
}

async function installCertificateInMacLoginKeychain(filePath: string): Promise<boolean> {
  try {
    await execFileAsync('/usr/bin/security', [
      'add-trusted-cert',
      '-r',
      'trustRoot',
      '-k',
      join(homedir(), 'Library', 'Keychains', 'login.keychain-db'),
      filePath
    ])
    return true
  } catch {
    return false
  }
}

function safeCertificateFileStem(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safe || 'orca-relay-ca'
}
