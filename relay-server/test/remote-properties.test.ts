import { describe, expect, it } from 'vitest'
import { parseProperties, parseRemoteRelayDeployProperties } from '../src/remote-properties.js'

describe('remote.properties parsing', () => {
  it('parses scp aliases and relay env settings', () => {
    const config = parseRemoteRelayDeployProperties(
      `
      # SSH/SFTP connection
      scp.host = 203.0.113.10
      scp.user = ubuntu
      scp.password = pass\\=word
      scp.port = 2222

      remote.dir = /srv/orca-relay
      upload.include = dist, package.json, certs
      local.buildCommand = pnpm run build
      remote.nodeCommand = /usr/bin/node

      relay.publicUrl = wss://203.0.113.10:6770
      relay.port = 6770
      relay.v2StorePath = /srv/orca-relay/data/relay-v2.json
      relay.adminToken = admin-secret
      relay.trustProxy = true
      env.RELAY_MAX_CONCURRENT_CONNECTIONS = 50
      `,
      '/tmp/remote.properties'
    )

    expect(config.host).toBe('203.0.113.10')
    expect(config.port).toBe(2222)
    expect(config.username).toBe('ubuntu')
    expect(config.password).toBe('pass=word')
    expect(config.remoteDir).toBe('/srv/orca-relay')
    expect(config.uploadPaths).toEqual(['dist', 'package.json', 'certs'])
    expect(config.localBuildCommand).toBe('pnpm run build')
    expect(config.remoteNodeCommand).toBe('/usr/bin/node')
    expect(config.relayEnv).toMatchObject({
      RELAY_PUBLIC_URL: 'wss://203.0.113.10:6770',
      RELAY_PORT: '6770',
      RELAY_V2_STORE_PATH: '/srv/orca-relay/data/relay-v2.json',
      RELAY_ADMIN_TOKEN: 'admin-secret',
      RELAY_TRUST_PROXY: 'true',
      RELAY_MAX_CONCURRENT_CONNECTIONS: '50'
    })
  })

  it('supports comments, colon separators, and continued lines', () => {
    const properties = parseProperties(`
      ! comment
      ssh.host: relay.example.com
      ssh.username = deploy
      remote.installCommand = npm install \\
        --omit=dev
    `)

    expect(properties.get('ssh.host')).toBe('relay.example.com')
    expect(properties.get('ssh.username')).toBe('deploy')
    expect(properties.get('remote.installCommand')).toBe('npm install         --omit=dev')
  })

  it('derives relay URL and local cert mode from an IP domain', () => {
    const config = parseRemoteRelayDeployProperties(`
      domain=203.0.113.10:7443
      ssh.username=ubuntu
      ssh.password=secret
      remote.dir=/opt/orca-relay
    `)

    expect(config.host).toBe('203.0.113.10')
    expect(config.domain?.publicUrl).toBe('wss://203.0.113.10:7443')
    expect(config.relayEnv.RELAY_PUBLIC_URL).toBe('wss://203.0.113.10:7443')
    expect(config.relayEnv.RELAY_PORT).toBe('7443')
    expect(config.localCertificate).toMatchObject({
      enabled: true,
      host: '203.0.113.10',
      outDir: 'certs'
    })
    expect(config.uploadPaths).toEqual(['dist', 'package.json', 'pnpm-lock.yaml', 'certs'])
    expect(config.relayEnv.RELAY_TLS_CERT_FILE).toBe(
      '/opt/orca-relay/current/certs/orca-relay-server.pem'
    )
    expect(config.relayEnv.RELAY_TLS_KEY_FILE).toBe(
      '/opt/orca-relay/current/certs/orca-relay-server-key.pem'
    )
  })

  it('rejects unsafe upload paths and invalid env keys', () => {
    expect(() =>
      parseRemoteRelayDeployProperties(`
        ssh.host=relay.example.com
        ssh.username=deploy
        upload.include=../dist
      `)
    ).toThrow('upload.include path cannot contain ..')

    expect(() =>
      parseRemoteRelayDeployProperties(`
        ssh.host=relay.example.com
        ssh.username=deploy
        env.bad-name=value
      `)
    ).toThrow('Invalid environment variable name')
  })
})
