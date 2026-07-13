import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'

// Why: the room store holds the secrets that authenticate the PC and phone to
// the relay. Mirror the desktop's secure-file pattern (src/shared/secure-file.ts):
// write to a temp file, chmod 0600, then atomically rename into place so a
// reader never sees a half-written or world-readable credential file.
export function writeSecureJson(targetPath: string, value: unknown): void {
  const dir = dirname(targetPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  applyOwnerOnly(dir, true)

  const tmpFile = `${targetPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tmpFile, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 })
    applyOwnerOnly(tmpFile, false)
    renameSync(tmpFile, targetPath)
    applyOwnerOnly(targetPath, false)
  } catch (error) {
    rmSync(tmpFile, { force: true })
    throw error
  }
}

export function writeOwnerOnlyFile(targetPath: string, contents: Buffer | string): void {
  const dir = dirname(targetPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  applyOwnerOnly(dir, true)

  const tmpFile = `${targetPath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tmpFile, contents, { mode: 0o600 })
    applyOwnerOnly(tmpFile, false)
    renameSync(tmpFile, targetPath)
    applyOwnerOnly(targetPath, false)
  } catch (error) {
    rmSync(tmpFile, { force: true })
    throw error
  }
}

export function readSecureJson<T>(targetPath: string): T | null {
  if (!existsSync(targetPath)) {
    return null
  }
  const contents = readFileSync(targetPath, 'utf-8')
  return JSON.parse(contents) as T
}

// Why: chmod is a no-op on Windows; the relay is expected to run on a Linux
// host (its reference deployment is Docker), so POSIX permissions are the
// security boundary. On Windows this is best-effort and the operator should
// rely on directory ACLs — kept non-fatal so the relay still starts.
function applyOwnerOnly(targetPath: string, isDirectory: boolean): void {
  if (process.platform === 'win32') {
    return
  }
  chmodSync(targetPath, isDirectory ? 0o700 : 0o600)
}
