import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildRemoteRelayDeployPlan,
  collectRemoteDeployFiles,
  quoteRemoteShell
} from '../src/remote-deploy.js'
import type { RemoteRelayDeployConfig } from '../src/remote-properties.js'

describe('remote deploy planning', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-relay-deploy-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('collects deploy files under their relay-server relative paths', () => {
    mkdirSync(join(dir, 'dist', 'nested'), { recursive: true })
    writeFileSync(join(dir, 'dist', 'cli.js'), 'cli')
    writeFileSync(join(dir, 'dist', 'nested', 'server.js'), 'server')
    writeFileSync(join(dir, 'package.json'), '{}')

    const files = collectRemoteDeployFiles(dir, ['dist', 'package.json'])

    expect(files.map((file) => file.relativePath)).toEqual([
      'dist/cli.js',
      'dist/nested/server.js',
      'package.json'
    ])
  })

  it('builds default install, stop, and start commands', () => {
    const config = configForTest({
      remoteDir: '/srv/orca relay',
      remotePidFile: '/srv/orca relay/relay.pid',
      remoteLogFile: '/srv/orca relay/relay.log',
      relayEnv: {
        RELAY_PUBLIC_URL: 'wss://203.0.113.10:6770',
        RELAY_TRUST_PROXY: 'true'
      }
    })
    const plan = buildRemoteRelayDeployPlan(config, new Date('2026-07-03T12:34:56.000Z'))

    expect(plan.releaseName).toBe(`20260703123456-${process.pid}`)
    expect(plan.releaseDir).toBe(`/srv/orca relay/releases/${plan.releaseName}`)
    expect(plan.currentDir).toBe('/srv/orca relay/current')
    expect(plan.createDirsCommand).toContain("'/srv/orca relay/releases'")
    expect(plan.stopCommand).toContain('kill "$(cat \'/srv/orca relay/relay.pid\')"')
    expect(plan.startCommand).toContain("cd '/srv/orca relay/current'")
    expect(plan.startCommand).toContain("RELAY_PUBLIC_URL='wss://203.0.113.10:6770'")
    expect(plan.startCommand).toContain("RELAY_STORE_PATH='/srv/orca relay/data/rooms.json'")
    expect(plan.startCommand).toContain('&& ( RELAY_HOST=')
    expect(plan.startCommand).toContain('nohup node dist/cli.js serve')
    expect(plan.startCommand).toContain("> '/srv/orca relay/relay.log'")
    expect(plan.startCommand).toContain("echo $! > '/srv/orca relay/relay.pid' )")
  })

  it('applies custom command templates', () => {
    const config = configForTest({
      remoteStopCommand: 'systemctl --user stop orca-relay',
      remoteStartCommand: '{env} systemctl --user start orca-relay'
    })
    const plan = buildRemoteRelayDeployPlan(config, new Date('2026-07-03T12:34:56.000Z'))

    expect(plan.stopCommand).toBe('systemctl --user stop orca-relay')
    expect(plan.startCommand).toContain('RELAY_HOST=')
    expect(plan.startCommand).toContain('systemctl --user start orca-relay')
  })

  it('creates custom v2 store directories during deploy planning', () => {
    const config = configForTest({
      relayEnv: {
        RELAY_STORE_PATH: '/srv/orca-relay/data/rooms.json',
        RELAY_V2_STORE_PATH: '/srv/orca-relay/v2/relay-v2.json'
      }
    })
    const plan = buildRemoteRelayDeployPlan(config, new Date('2026-07-03T12:34:56.000Z'))

    expect(plan.createDirsCommand).toContain("'/srv/orca-relay/data'")
    expect(plan.createDirsCommand).toContain("'/srv/orca-relay/v2'")
    expect(plan.startCommand).toContain("RELAY_V2_STORE_PATH='/srv/orca-relay/v2/relay-v2.json'")
  })

  it('quotes single quotes for remote shell commands', () => {
    expect(quoteRemoteShell("it's here")).toBe("'it'\\''s here'")
  })
})

function configForTest(overrides: Partial<RemoteRelayDeployConfig> = {}): RemoteRelayDeployConfig {
  return {
    sourcePath: '/tmp/remote.properties',
    host: '203.0.113.10',
    port: 22,
    username: 'deploy',
    remoteDir: '/srv/orca-relay',
    uploadPaths: ['dist', 'package.json'],
    localBuildCommand: 'npm run build',
    remoteInstallCommand: 'npm install --omit=dev --no-audit --no-fund',
    remoteNodeCommand: 'node',
    remotePidFile: '/srv/orca-relay/relay.pid',
    remoteLogFile: '/srv/orca-relay/relay.log',
    relayEnv: {},
    domain: null,
    localCertificate: { enabled: false, host: null, outDir: 'certs' },
    ...overrides
  }
}
