import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { posix as posixPath } from 'node:path'
import { ensureLocalCertificateBundle } from './remote-local-certificate.js'
import { loadRemoteRelayDeployConfig, type RemoteRelayDeployConfig } from './remote-properties.js'
import {
  connectRemoteSsh,
  execRemote,
  openRemoteSftp,
  type RemoteUploadFile,
  uploadFilesToRelease
} from './remote-ssh-transfer.js'

export type RemoteRelayDeployOptions = {
  configPath: string
  relayRootDir: string
  skipBuild?: boolean
  stdout?: Pick<NodeJS.WriteStream, 'write'>
  stderr?: Pick<NodeJS.WriteStream, 'write'>
}

export type RemoteRelayDeployPlan = {
  releaseName: string
  releasesDir: string
  releaseDir: string
  currentDir: string
  installCommand: string
  stopCommand: string
  startCommand: string
  createDirsCommand: string
}

type TemplateValues = {
  remoteDir: string
  releasesDir: string
  releaseDir: string
  currentDir: string
  pidFile: string
  logFile: string
  env: string
}

export async function deployRelayToRemote(options: RemoteRelayDeployOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout
  const config = loadRemoteRelayDeployConfig(options.configPath)
  const plan = buildRemoteRelayDeployPlan(config)

  if (!options.skipBuild) {
    stdout.write(`[deploy] building relay-server: ${config.localBuildCommand}\n`)
    await runLocalCommand(config.localBuildCommand, options.relayRootDir)
  }
  const certificateToken = ensureLocalCertificateBundle(config, options.relayRootDir, stdout)
  const uploadFiles = collectRemoteDeployFiles(options.relayRootDir, config.uploadPaths)

  stdout.write(`[deploy] connecting to ${config.username}@${config.host}:${config.port}\n`)
  const client = await connectRemoteSsh(config)
  try {
    await execRemote(client, plan.createDirsCommand)
    const sftp = await openRemoteSftp(client)
    try {
      stdout.write(`[deploy] uploading ${uploadFiles.length} files to ${plan.releaseDir}\n`)
      await uploadFilesToRelease(sftp, uploadFiles, plan.releaseDir)
    } finally {
      sftp.end()
    }

    stdout.write('[deploy] installing production dependencies on remote\n')
    await execRemote(client, `cd ${quoteRemoteShell(plan.releaseDir)} && ${plan.installCommand}`)
    stdout.write('[deploy] switching current release\n')
    await execRemote(
      client,
      `ln -sfn ${quoteRemoteShell(plan.releaseDir)} ${quoteRemoteShell(plan.currentDir)}`
    )
    stdout.write('[deploy] restarting remote relay-server\n')
    await execRemote(client, plan.stopCommand)
    await execRemote(client, plan.startCommand)
    stdout.write(`[deploy] remote relay-server started from ${plan.currentDir}\n`)
    stdout.write(`[deploy] log: ${config.remoteLogFile}\n`)
    if (certificateToken) {
      stdout.write('\nCertificate token (paste into Orca Mobile or Orca desktop to install CA):\n')
      stdout.write(`  ${certificateToken}\n`)
    }
  } finally {
    client.end()
  }
}

export function buildRemoteRelayDeployPlan(
  config: RemoteRelayDeployConfig,
  now = new Date()
): RemoteRelayDeployPlan {
  const releaseName = buildReleaseName(now)
  const releasesDir = posixPath.join(config.remoteDir, 'releases')
  const releaseDir = posixPath.join(releasesDir, releaseName)
  const currentDir = posixPath.join(config.remoteDir, 'current')
  const env = buildRemoteEnvAssignments(config)
  const templateValues: TemplateValues = {
    remoteDir: config.remoteDir,
    releasesDir,
    releaseDir,
    currentDir,
    pidFile: config.remotePidFile,
    logFile: config.remoteLogFile,
    env
  }
  const createDirsCommand = [
    'mkdir -p',
    quoteRemoteShell(releasesDir),
    quoteRemoteShell(releaseDir),
    quoteRemoteShell(posixPath.dirname(config.remotePidFile)),
    quoteRemoteShell(posixPath.dirname(config.remoteLogFile)),
    ...relayDirectoryArgs(config)
  ].join(' ')
  return {
    releaseName,
    releasesDir,
    releaseDir,
    currentDir,
    installCommand: config.remoteInstallCommand,
    createDirsCommand,
    stopCommand: config.remoteStopCommand
      ? applyCommandTemplate(config.remoteStopCommand, templateValues)
      : buildDefaultStopCommand(config.remotePidFile),
    startCommand: config.remoteStartCommand
      ? applyCommandTemplate(config.remoteStartCommand, templateValues)
      : buildDefaultStartCommand(config, currentDir, env)
  }
}

export function collectRemoteDeployFiles(
  relayRootDir: string,
  uploadPaths: string[]
): RemoteUploadFile[] {
  const files: RemoteUploadFile[] = []
  for (const uploadPath of uploadPaths) {
    const localPath = resolve(relayRootDir, uploadPath)
    assertInsideRelayRoot(relayRootDir, localPath)
    if (!existsSync(localPath)) {
      throw new Error(`Upload path does not exist: ${uploadPath}`)
    }
    const stat = statSync(localPath)
    if (stat.isDirectory()) {
      collectDirectoryFiles(relayRootDir, localPath, files)
    } else if (stat.isFile()) {
      files.push({ localPath, relativePath: toPosixRelative(relayRootDir, localPath) })
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function quoteRemoteShell(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function buildReleaseName(now: Date): string {
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14)
  return `${stamp}-${process.pid}`
}

function collectDirectoryFiles(
  relayRootDir: string,
  directory: string,
  files: RemoteUploadFile[]
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const localPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      collectDirectoryFiles(relayRootDir, localPath, files)
      continue
    }
    if (isFileLike(entry, localPath)) {
      files.push({ localPath, relativePath: toPosixRelative(relayRootDir, localPath) })
    }
  }
}

function isFileLike(entry: Dirent, localPath: string): boolean {
  if (entry.isFile()) {
    return true
  }
  if (!entry.isSymbolicLink()) {
    return false
  }
  return statSync(localPath).isFile()
}

function assertInsideRelayRoot(relayRootDir: string, localPath: string): void {
  const root = resolve(relayRootDir)
  const rel = relative(root, localPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Upload path must stay inside relay-server: ${localPath}`)
  }
}

function toPosixRelative(relayRootDir: string, localPath: string): string {
  return relative(resolve(relayRootDir), localPath).split(sep).join('/')
}

function buildRemoteEnvAssignments(config: RemoteRelayDeployConfig): string {
  const env = {
    RELAY_HOST: '0.0.0.0',
    RELAY_PORT: '6770',
    RELAY_STORE_PATH: posixPath.join(config.remoteDir, 'data', 'rooms.json'),
    ...config.relayEnv
  }
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteRemoteShell(value)}`)
    .join(' ')
}

function relayDirectoryArgs(config: RemoteRelayDeployConfig): string[] {
  const storePaths = [config.relayEnv.RELAY_STORE_PATH, config.relayEnv.RELAY_V2_STORE_PATH]
  const dirs = new Set<string>()
  for (const storePath of storePaths) {
    if (storePath?.startsWith('/')) {
      dirs.add(posixPath.dirname(storePath))
    }
  }
  if (dirs.size === 0) {
    dirs.add(posixPath.join(config.remoteDir, 'data'))
  }
  return [...dirs].sort().map(quoteRemoteShell)
}

function buildDefaultStopCommand(pidFile: string): string {
  const pid = quoteRemoteShell(pidFile)
  return `if [ -f ${pid} ]; then kill "$(cat ${pid})" 2>/dev/null || true; rm -f ${pid}; fi`
}

function buildDefaultStartCommand(
  config: RemoteRelayDeployConfig,
  currentDir: string,
  env: string
): string {
  return [
    `cd ${quoteRemoteShell(currentDir)}`,
    '&&',
    '(',
    env,
    'nohup',
    config.remoteNodeCommand,
    'dist/cli.js serve',
    '>',
    quoteRemoteShell(config.remoteLogFile),
    '2>&1 < /dev/null & echo $! >',
    quoteRemoteShell(config.remotePidFile),
    ')'
  ].join(' ')
}

function applyCommandTemplate(command: string, values: TemplateValues): string {
  return command.replace(
    /\{(remoteDir|releasesDir|releaseDir|currentDir|pidFile|logFile|env)\}/g,
    (_match, key: keyof TemplateValues) => values[key]
  )
}

async function runLocalCommand(command: string, cwd: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`Local command failed with exit code ${code}: ${command}`))
    })
  })
}
