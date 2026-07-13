export function logRelayV2PcOnline(pcId: string, remoteAddress: string | undefined): void {
  console.info(`[relay:v2] pc online pc=${pcId} remote=${remoteAddress ?? 'unknown'}`)
}

export function logRelayV2PcOffline(pcId: string, orphanedMobiles: number): void {
  console.info(`[relay:v2] pc offline pc=${pcId} orphanedMobiles=${orphanedMobiles}`)
}

export function logRelayV2MobileJoinPcOffline(channelId: string): void {
  console.info(`[relay:v2] mobile join rejected reason=pc-offline channel=${channelId}`)
}

export function logRelayV2MobileResumePcOffline(pcId: string, mobileDeviceId: string): void {
  console.info(
    `[relay:v2] mobile resume rejected reason=pc-offline pc=${pcId} mobile=${mobileDeviceId}`
  )
}

export function logRelayV2MobileBound(input: {
  pcId: string
  mobileDeviceId: string
  channelId: string
}): void {
  console.info(
    `[relay:v2] mobile bound pc=${input.pcId} mobile=${input.mobileDeviceId} channel=${input.channelId}`
  )
}

export function logRelayV2MobileResumed(input: {
  pcId: string
  mobileDeviceId: string
  channelId: string
}): void {
  console.info(
    `[relay:v2] mobile resumed pc=${input.pcId} mobile=${input.mobileDeviceId} channel=${input.channelId}`
  )
}

export function logRelayV2MobileReconnecting(pcId: string, mobileDeviceId: string): void {
  console.info(`[relay:v2] mobile reconnecting pc=${pcId} mobile=${mobileDeviceId}`)
}
