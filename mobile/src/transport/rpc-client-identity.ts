import type { RpcClient } from './rpc-client'

// Why: derive a stable per-instance identity for RpcClient so a wireUp effect's
// dep key changes when forceReconnect swaps the underlying client for a host
// (without this, listeners stay attached to the closed client and
// notifications/accounts subs never re-attach). Module-level so the identity
// map is a single source of truth across the app.
const clientIdentities = new WeakMap<RpcClient, number>()
let nextClientIdentity = 1

export function clientKey(client: RpcClient): number {
  let id = clientIdentities.get(client)
  if (id == null) {
    id = nextClientIdentity++
    clientIdentities.set(client, id)
  }
  return id
}
