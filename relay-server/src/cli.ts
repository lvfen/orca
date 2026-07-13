import { basename, dirname } from 'node:path'
import { loadConfig, type RelayConfig } from './config.js'
import { generateRelayCertificateBundle } from './certificate-authority.js'
import { deployRelayToRemote } from './remote-deploy.js'
import { RelayServer } from './relay-server.js'
import {
  runDisconnectPc,
  runListConnections,
  runRevokeChannel,
  runRevokeMobile
} from './relay-v2-admin-cli.js'
import { RoomStore } from './room-store.js'
import { RelayV2Store } from './v2/relay-v2-store.js'

type ParsedArgs = {
  command: string | undefined
  positionals: string[]
  flags: Map<string, string>
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv
  const positionals: string[] = []
  const flags = new Map<string, string>()
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === undefined) {
      continue
    }
    if (arg === '--') {
      continue
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = rest[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        i++
      } else {
        flags.set(key, 'true')
      }
    } else {
      positionals.push(arg)
    }
  }
  return { command, positionals, flags }
}

function runGenerateSelfSignedCa(flags: Map<string, string>): void {
  const host = flags.get('host')
  const outDir = flags.get('out-dir') ?? '.orca-relay-certs'
  if (!host) {
    process.stderr.write(
      'Usage: relay-server generate-self-signed-ca --host <ip-or-hostname> [--out-dir ./certs]\n'
    )
    process.exitCode = 1
    return
  }
  const bundleOptions = {
    host,
    outDir
  }
  const name = flags.get('name')
  const caDays = parseOptionalPositiveIntFlag(flags, 'ca-days')
  const serverDays = parseOptionalPositiveIntFlag(flags, 'server-days')
  const relayUrlOverride = flags.get('relay-url')
  const bundle = generateRelayCertificateBundle({
    ...bundleOptions,
    ...(name === undefined ? {} : { name }),
    ...(caDays === undefined ? {} : { caDays }),
    ...(serverDays === undefined ? {} : { serverDays }),
    ...(relayUrlOverride === undefined ? {} : { relayUrl: relayUrlOverride })
  })
  const relayUrl = relayUrlOverride ?? bundle.relayUrl
  process.stdout.write(
    [
      `Generated self-signed Orca Relay CA for ${bundle.host}`,
      `  CA certificate:       ${bundle.caCertPath}`,
      `  iOS profile:          ${bundle.caMobileConfigPath}`,
      `  Certificate token:    ${bundle.caTokenPath}`,
      `  Server certificate:   ${bundle.serverCertPath}`,
      `  Server private key:   ${bundle.serverKeyPath}`,
      '',
      'Start the relay with:',
      `  RELAY_PUBLIC_URL=${relayUrl} \\`,
      `  RELAY_TLS_CERT_FILE=${bundle.serverCertPath} \\`,
      `  RELAY_TLS_KEY_FILE=${bundle.serverKeyPath} \\`,
      '  relay-server serve',
      '',
      'Install on iOS:',
      `  1. Send ${bundle.caMobileConfigPath} to the iPhone/iPad and open it.`,
      '  2. Settings → General → VPN & Device Management → install the profile.',
      '  3. Settings → General → About → Certificate Trust Settings → enable full trust.',
      '',
      'Certificate token (paste into Orca Mobile or Orca desktop to install CA):',
      `  ${bundle.certificateToken}`,
      '',
      'Then configure this relay URL in Orca desktop Remote Relay settings:',
      `  ${relayUrl}`,
      ''
    ].join('\n')
  )
}

async function runDeployRemote(flags: Map<string, string>): Promise<void> {
  const configPath = flags.get('config') ?? 'remote.properties'
  await deployRelayToRemote({
    configPath,
    relayRootDir: relayPackageRoot(),
    ...(flags.has('skip-build') ? { skipBuild: true } : {})
  })
}

async function runServe(config: RelayConfig): Promise<void> {
  const store = new RoomStore(config.storePath)
  const v2Store = config.v2StorePath ? new RelayV2Store(config.v2StorePath) : undefined
  const relayV2 = config.certificateDiscovery
    ? {
        serverCaSha256: config.certificateDiscovery.caSha256B64,
        serverCaDerB64: config.certificateDiscovery.caCertDer.toString('base64')
      }
    : undefined
  const server = new RelayServer({
    config,
    store,
    ...(v2Store ? { v2Store } : {}),
    ...(relayV2 ? { relayV2 } : {})
  })
  await server.start()
  const scheme = config.tlsCert && config.tlsKey ? 'wss' : 'ws'
  process.stdout.write(
    `[relay] listening on ${scheme}://${config.host}:${server.resolvedPort} (public ${config.publicUrl})\n`
  )

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    process.stdout.write(`\n[relay] ${signal} received, shutting down…\n`)
    void server.stop().then(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

function printUsage(): void {
  process.stdout.write(
    [
      'orca relay-server',
      '',
      'Usage:',
      '  relay-server serve',
      '  relay-server generate-self-signed-ca --host <ip-or-hostname> [--out-dir ./certs]',
      '  relay-server deploy-remote [--config remote.properties] [--skip-build]',
      '  relay-server list-connections',
      '  relay-server disconnect-pc <pcId>',
      '  relay-server revoke-channel <channelId>',
      '  relay-server revoke-mobile <mobileDeviceId>',
      '',
      'Env: RELAY_PORT, RELAY_HOST, RELAY_PUBLIC_URL, RELAY_STORE_PATH, RELAY_ACCESS_TOKEN,',
      '     RELAY_TLS_CERT_FILE, RELAY_TLS_KEY_FILE,',
      '     RELAY_MAX_CONN_PER_IP_PER_MIN, RELAY_MAX_CONCURRENT_CONNECTIONS, RELAY_TRUST_PROXY',
      '',
      'Health: GET /healthz (or /metrics) on the same port returns JSON counters.',
      ''
    ].join('\n')
  )
}

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'serve':
    case undefined:
      await runServe(loadConfig())
      return
    case 'generate-self-signed-ca':
      runGenerateSelfSignedCa(flags)
      return
    case 'deploy-remote':
      await runDeployRemote(flags)
      return
    case 'list-connections':
      runListConnections(loadConfig())
      return
    case 'disconnect-pc':
      runDisconnectPc(loadConfig(), positionals)
      return
    case 'revoke-channel':
      runRevokeChannel(loadConfig(), positionals)
      return
    case 'revoke-mobile':
      runRevokeMobile(loadConfig(), positionals)
      return
    case 'help':
    case '--help':
    case '-h':
      printUsage()
      return
    default:
      process.stderr.write(`Unknown command: ${command}\n`)
      printUsage()
      process.exitCode = 1
  }
}

function relayPackageRoot(): string {
  const moduleDir = import.meta.dirname
  const leaf = basename(moduleDir)
  return leaf === 'src' || leaf === 'dist' ? dirname(moduleDir) : process.cwd()
}

function parseOptionalPositiveIntFlag(flags: Map<string, string>, key: string): number | undefined {
  const raw = flags.get(key)
  if (raw === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive integer`)
  }
  return parsed
}

void main().catch((error: unknown) => {
  process.stderr.write(`[relay] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
