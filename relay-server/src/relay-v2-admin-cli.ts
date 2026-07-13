import type { RelayConfig } from './config.js'
import {
  disconnectRelayV2PcInStore,
  revokeRelayV2ChannelInStore,
  revokeRelayV2MobileInStore,
  snapshotRelayV2Connections
} from './v2/relay-v2-admin-store.js'
import { RelayV2Store } from './v2/relay-v2-store.js'

export function runListConnections(config: RelayConfig): void {
  process.stdout.write(
    `${JSON.stringify(snapshotRelayV2Connections(openV2Store(config)), null, 2)}\n`
  )
}

export function runDisconnectPc(config: RelayConfig, positionals: string[]): void {
  const pcId = requirePositional(positionals, 'pcId', 'disconnect-pc <pcId>')
  if (!pcId) {
    return
  }
  writeAction('Disconnected PC', pcId, disconnectRelayV2PcInStore(openV2Store(config), pcId))
}

export function runRevokeChannel(config: RelayConfig, positionals: string[]): void {
  const channelId = requirePositional(positionals, 'channelId', 'revoke-channel <channelId>')
  if (!channelId) {
    return
  }
  writeAction(
    'Revoked channel',
    channelId,
    revokeRelayV2ChannelInStore(openV2Store(config), channelId)
  )
}

export function runRevokeMobile(config: RelayConfig, positionals: string[]): void {
  const mobileDeviceId = requirePositional(
    positionals,
    'mobileDeviceId',
    'revoke-mobile <mobileDeviceId>'
  )
  if (!mobileDeviceId) {
    return
  }
  writeAction(
    'Revoked mobile',
    mobileDeviceId,
    revokeRelayV2MobileInStore(openV2Store(config), mobileDeviceId)
  )
}

function openV2Store(config: RelayConfig): RelayV2Store {
  if (!config.v2StorePath) {
    throw new Error('RELAY_V2_STORE_PATH is not configured')
  }
  return new RelayV2Store(config.v2StorePath)
}

function requirePositional(positionals: string[], name: string, usage: string): string | undefined {
  const value = positionals[0]
  if (value) {
    return value
  }
  process.stderr.write(`Usage: relay-server ${usage}\nMissing ${name}.\n`)
  process.exitCode = 1
  return undefined
}

function writeAction(label: string, id: string, ok: boolean): void {
  if (ok) {
    process.stdout.write(`${label} ${id}.\n`)
    return
  }
  process.stderr.write(`No matching record for ${id}.\n`)
  process.exitCode = 1
}
