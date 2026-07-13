import type { RelayInviteV2Payload } from './relay-v2-invite'

export function buildRelayV2CertificateMobileConfig(input: {
  invite: RelayInviteV2Payload
  profileUuid: string
  certificateUuid: string
}): string {
  const displayName = `Orca Relay CA ${relayHost(input.invite.relayUrl)}`
  const profileId = `ai.orca.relay.ca.${input.profileUuid}`
  const certificateId = `${profileId}.root`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>orca-relay-ca.cer</string>
      <key>PayloadContent</key>
      <data>${chunkBase64(input.invite.serverCaDerB64)}</data>
      <key>PayloadDescription</key>
      <string>Orca relay local CA certificate</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXml(displayName)}</string>
      <key>PayloadIdentifier</key>
      <string>${certificateId}</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${input.certificateUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Installs the local CA used by the Orca relay server.</string>
  <key>PayloadDisplayName</key>
  <string>${escapeXml(displayName)}</string>
  <key>PayloadIdentifier</key>
  <string>${profileId}</string>
  <key>PayloadOrganization</key>
  <string>Orca</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${input.profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`
}

function relayHost(relayUrl: string): string {
  try {
    return new URL(relayUrl).host
  } catch {
    return 'local'
  }
}

function chunkBase64(value: string): string {
  const chunks: string[] = []
  for (let index = 0; index < value.length; index += 64) {
    chunks.push(value.slice(index, index + 64))
  }
  return `\n${chunks.map((chunk) => `      ${chunk}`).join('\n')}\n      `
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
