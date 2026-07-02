import { loadConfig, type RelayConfig } from './config.js'
import { RelayServer } from './relay-server.js'
import { RoomStore } from './room-store.js'

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

function runGeneratePair(config: RelayConfig, flags: Map<string, string>): void {
  const name = flags.get('name') ?? 'orca-host'
  const relayUrl = flags.get('relay-url') ?? config.publicUrl
  const store = new RoomStore(config.storePath)
  const room = store.createPair(relayUrl, name)
  process.stdout.write(
    [
      `Generated relay room "${room.name}"`,
      `  roomId:       ${room.roomId}`,
      `  relayUrl:     ${relayUrl}`,
      `  store:        ${config.storePath}`,
      '',
      'PC token (paste into desktop Server Token settings):',
      `  ${room.pcToken}`,
      '',
      'Mobile token (paste into phone "Add via Server Token"):',
      `  ${room.mobileToken}`,
      ''
    ].join('\n')
  )
}

function runRevoke(config: RelayConfig, positionals: string[]): void {
  const roomId = positionals[0]
  if (!roomId) {
    process.stderr.write('Usage: relay-server revoke <roomId>\n')
    process.exitCode = 1
    return
  }
  const store = new RoomStore(config.storePath)
  const removed = store.revoke(roomId)
  if (removed) {
    process.stdout.write(`Revoked room ${roomId}. New joins with its tokens are now rejected.\n`)
  } else {
    process.stderr.write(`No room with id ${roomId}.\n`)
    process.exitCode = 1
  }
}

async function runServe(config: RelayConfig): Promise<void> {
  const store = new RoomStore(config.storePath)
  const server = new RelayServer({ config, store })
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
      '  relay-server generate-pair --name "my-mac" [--relay-url wss://relay.example.com]',
      '  relay-server revoke <roomId>',
      '',
      'Env: RELAY_PORT, RELAY_HOST, RELAY_PUBLIC_URL, RELAY_STORE_PATH,',
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
  const config = loadConfig()
  switch (command) {
    case 'serve':
    case undefined:
      await runServe(config)
      return
    case 'generate-pair':
      runGeneratePair(config, flags)
      return
    case 'revoke':
      runRevoke(config, positionals)
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

void main().catch((error: unknown) => {
  process.stderr.write(`[relay] fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
