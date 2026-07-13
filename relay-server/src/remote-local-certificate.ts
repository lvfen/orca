import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import forge from 'node-forge'
import { certificateBundlePaths, generateRelayCertificateBundle } from './certificate-authority.js'
import { buildRelayCertificateToken } from './certificate-token.js'
import { hostForUrl } from './remote-domain.js'
import type { RemoteRelayDeployConfig } from './remote-properties.js'
import { writeOwnerOnlyFile } from './secure-file.js'

export function ensureLocalCertificateBundle(
  config: RemoteRelayDeployConfig,
  relayRootDir: string,
  stdout: Pick<NodeJS.WriteStream, 'write'>
): string | null {
  if (!config.localCertificate.enabled || !config.localCertificate.host) {
    return null
  }
  const certDir = resolve(relayRootDir, config.localCertificate.outDir)
  const paths = certificateBundlePaths(certDir)
  const name = config.localCertificate.name ?? `Orca Relay ${config.localCertificate.host}`
  const relayUrl =
    config.relayEnv.RELAY_PUBLIC_URL ?? `wss://${hostForUrl(config.localCertificate.host)}`
  if (!certificateBundleIsUsable(paths)) {
    stdout.write(`[deploy] generating local relay CA in ${config.localCertificate.outDir}\n`)
    return generateRelayCertificateBundle({
      host: config.localCertificate.host,
      outDir: certDir,
      name,
      relayUrl
    }).certificateToken
  }
  stdout.write(`[deploy] using existing local relay CA from ${config.localCertificate.outDir}\n`)
  const certificateToken = buildRelayCertificateToken({
    name,
    host: config.localCertificate.host,
    relayUrl,
    caCertDer: readFileSync(paths.caDerPath),
    iosMobileConfig: readFileSync(paths.caMobileConfigPath, 'utf8')
  })
  writeOwnerOnlyFile(paths.caTokenPath, certificateToken)
  return certificateToken
}

function certificateBundleIsUsable(paths: ReturnType<typeof certificateBundlePaths>): boolean {
  if (
    !existsSync(paths.caDerPath) ||
    !existsSync(paths.caMobileConfigPath) ||
    !existsSync(paths.serverCertPath) ||
    !existsSync(paths.serverKeyPath)
  ) {
    return false
  }
  try {
    const caAsn1 = forge.asn1.fromDer(readFileSync(paths.caDerPath).toString('binary'))
    const caCert = forge.pki.certificateFromAsn1(caAsn1)
    const serverCert = forge.pki.certificateFromPem(readFileSync(paths.serverCertPath, 'utf8'))
    // Why: older forge-generated relay leaf certs carried a bad authority key
    // id that OpenSSL/Node reject even though forge signature checks pass.
    if (serverCert.getExtension('authorityKeyIdentifier')) {
      return false
    }
    return caCert.verify(serverCert)
  } catch {
    return false
  }
}
