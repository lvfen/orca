import { randomUUID } from 'node:crypto'

export function createIosCaMobileConfig(input: {
  displayName: string
  certificateDer: Buffer
}): string {
  const profileUuid = randomUUID()
  const certUuid = randomUUID()
  const identifier = `com.orca.relay.ca.${profileUuid}`
  const displayName = escapeXml(`${input.displayName} CA`)
  const certBase64 = input.certificateDer.toString('base64')
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
      <data>${certBase64}</data>
      <key>PayloadDescription</key>
      <string>Installs the local Orca Relay certificate authority.</string>
      <key>PayloadDisplayName</key>
      <string>${displayName}</string>
      <key>PayloadIdentifier</key>
      <string>${identifier}.root</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${certUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Trust profile for an Orca Relay self-signed CA.</string>
  <key>PayloadDisplayName</key>
  <string>${displayName}</string>
  <key>PayloadIdentifier</key>
  <string>${identifier}</string>
  <key>PayloadOrganization</key>
  <string>Orca</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
