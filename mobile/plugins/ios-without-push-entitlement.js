const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { IOSConfig, withEntitlementsPlist, withFinalizedMod } = require('expo/config-plugins')

function removePushEntitlement(entitlements) {
  delete entitlements['aps-environment']
  return entitlements
}

function getFallbackEntitlementsPath(cfg) {
  const projectName = cfg.modRequest.projectName
  if (!projectName) {
    return null
  }
  return path.join(cfg.modRequest.platformProjectRoot, projectName, `${projectName}.entitlements`)
}

function removePushEntitlementFromFile(filePath) {
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :aps-environment', filePath])
    if (result.status === 0) {
      return
    }
  }

  const contents = fs.readFileSync(filePath, 'utf8')
  const next = contents.replace(
    /\n\s*<key>aps-environment<\/key>\s*\n\s*<string>[^<]*<\/string>/,
    ''
  )
  if (next !== contents) {
    fs.writeFileSync(filePath, next)
  }
}

module.exports = function withIosWithoutPushEntitlement(config) {
  config = withEntitlementsPlist(config, (cfg) => {
    // Why: desktop notifications are scheduled locally; APNs entitlement blocks
    // personal-team iPhone development builds.
    removePushEntitlement(cfg.modResults)
    return cfg
  })

  return withFinalizedMod(config, [
    'ios',
    async (cfg) => {
      const entitlementsPath =
        IOSConfig.Entitlements.getEntitlementsPath(cfg.modRequest.projectRoot) ??
        getFallbackEntitlementsPath(cfg)
      if (!entitlementsPath || !fs.existsSync(entitlementsPath)) {
        return cfg
      }

      removePushEntitlementFromFile(entitlementsPath)
      return cfg
    }
  ])
}
