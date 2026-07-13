import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { decodeRelayCertificateToken } from '../../shared/relay-certificate-token'
import type { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'

const execFileAsync = promisify(execFile)

export async function installRelayCertificateToken(
  args: { token: string },
  rpcServer: OrcaRuntimeRpcServer
) {
  const certificate = decodeRelayCertificateToken(
    typeof args?.token === 'string' ? args.token.trim() : ''
  )
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
  const filePath = join(dir, `${safeCertificateFileStem(certificate.name)}.cer`)
  await writeFile(filePath, caCertDer)
  const appTrusted = await rpcServer.trustRelayV2Certificate(certificate)
  if (process.platform === 'darwin') {
    const installed = await installCertificateInMacLoginKeychain(filePath)
    return installed || appTrusted
      ? { ok: true as const, filePath, installed, appTrusted }
      : { ok: false as const, reason: 'open-failed' as const }
  }
  const errorMessage = await shell.openPath(filePath)
  return !errorMessage || appTrusted
    ? { ok: true as const, filePath, installed: !errorMessage, appTrusted }
    : { ok: false as const, reason: 'open-failed' as const }
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
