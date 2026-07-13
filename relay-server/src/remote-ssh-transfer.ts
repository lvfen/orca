import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { posix as posixPath } from 'node:path'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { RemoteRelayDeployConfig } from './remote-properties.js'

export type RemoteUploadFile = {
  localPath: string
  relativePath: string
}

export async function connectRemoteSsh(config: RemoteRelayDeployConfig): Promise<Client> {
  const client = new Client()
  const connectConfig: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: config.username,
    ...optionalSshConfig('password', config.password),
    ...optionalSshConfig(
      'privateKey',
      config.privateKeyPath ? readFileSync(resolve(config.privateKeyPath), 'utf8') : undefined
    ),
    ...optionalSshConfig('passphrase', config.passphrase),
    ...optionalSshConfig('agent', config.agent)
  }
  await new Promise<void>((resolveReady, reject) => {
    client.once('ready', resolveReady)
    client.once('error', reject)
    client.connect(connectConfig)
  })
  client.removeAllListeners('error')
  return client
}

export async function openRemoteSftp(client: Client): Promise<SFTPWrapper> {
  return await new Promise<SFTPWrapper>((resolveSftp, reject) => {
    client.sftp((error, sftp) => {
      if (error) {
        reject(error)
        return
      }
      resolveSftp(sftp)
    })
  })
}

export async function uploadFilesToRelease(
  sftp: SFTPWrapper,
  files: RemoteUploadFile[],
  releaseDir: string
): Promise<void> {
  const createdDirs = new Set<string>()
  for (const file of files) {
    const remotePath = posixPath.join(releaseDir, file.relativePath)
    const remoteDir = posixPath.dirname(remotePath)
    if (!createdDirs.has(remoteDir)) {
      await ensureRemoteDirectory(sftp, remoteDir)
      createdDirs.add(remoteDir)
    }
    await fastPut(sftp, file.localPath, remotePath)
  }
}

export async function execRemote(client: Client, command: string): Promise<void> {
  const result = await new Promise<{ code: number; stderr: string }>((resolveExec, reject) => {
    client.exec(command, (error, stream) => {
      if (error) {
        reject(error)
        return
      }
      resolveRemoteStream(stream, resolveExec)
    })
  })
  if (result.code !== 0) {
    throw new Error(`Remote command failed with exit code ${result.code}: ${result.stderr}`)
  }
}

function optionalSshConfig<K extends keyof ConnectConfig>(
  key: K,
  value: ConnectConfig[K] | undefined
): Partial<Pick<ConnectConfig, K>> {
  return value === undefined ? {} : ({ [key]: value } as Pick<ConnectConfig, K>)
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const parts = remoteDir.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current = `${current}/${part}`
    await mkdirIfMissing(sftp, current)
  }
}

async function mkdirIfMissing(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  await new Promise<void>((resolveMkdir, reject) => {
    sftp.mkdir(remoteDir, (error) => {
      if (!error || sftpStatusCode(error) === 4) {
        resolveMkdir()
        return
      }
      reject(error)
    })
  })
}

function sftpStatusCode(error: Error): number | undefined {
  return 'code' in error && typeof error.code === 'number' ? error.code : undefined
}

async function fastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  await new Promise<void>((resolvePut, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolvePut()
    })
  })
}

function resolveRemoteStream(
  stream: ClientChannel,
  resolveExec: (value: { code: number; stderr: string }) => void
): void {
  let stderr = ''
  // Why: some sshd/ssh2 combinations do not emit close until stdout is drained,
  // even for commands that produce no meaningful output.
  stream.on('data', () => {})
  stream.stderr.on('data', (data: Buffer) => {
    stderr += data.toString('utf8')
  })
  stream.on('close', (code: number | null) => {
    resolveExec({ code: code ?? 0, stderr })
  })
}
