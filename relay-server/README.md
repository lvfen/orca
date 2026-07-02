# Orca Relay Server

A small, self-hostable **relay bridge** that lets an Orca desktop and one paired
phone reach each other after the phone leaves the LAN — **without opening any
inbound port on the desktop**. Both the desktop and the phone connect _outbound_
to this relay; the relay forwards opaque, end-to-end-encrypted frames between
them. It is a **dumb byte pipe**: it has no static secret key and therefore
cannot decrypt the traffic it carries.

See the design doc: [`../docs/mobile-relay-bridge.md`](../docs/mobile-relay-bridge.md).

## Model

- A **room** is a 1:1 binding of one **PC token** to one **mobile token**.
- Each token is a self-describing, base64url-encoded blob carrying
  `{ relayUrl, roomId, secret }`. A phone that pastes only the mobile token
  already knows which relay to dial and how to authenticate.
- A room has exactly one **host** slot (the PC) and one **client** slot (the
  phone). No multi-device, no multiplexing.

### Invariants

- **Supersede.** A new socket with a valid token evicts whoever held its slot
  (close code `4409 occupied`). A reconnecting PC/phone never fights a stale
  half-open copy of itself.
- **Lifecycle coupling.** When one slot genuinely drops, the relay recycles the
  paired slot too (close code `4408 peer-recycled`). Both sides then reconnect
  clean, and the desktop spins up a fresh E2EE session for the new pipe.

### Close codes (the reconnect contract)

| Code | Meaning | Peer behavior |
|---|---|---|
| `4409` occupied | another socket took the slot with the same token | **terminal** — do not auto-reconnect |
| `4408` peer-recycled | paired socket dropped, this one was recycled | **reconnect** and wait |
| `4401` unauthorized | token invalid / rotated / revoked | **terminal** — re-pair |
| `4400` bad-join | malformed/absent join frame | terminal |
| `1006`/`1000`/`1001` | network / relay restart | **reconnect** |

## Wire protocol

Thin plaintext-JSON control protocol + opaque data forwarding. After connecting,
a socket must send its join frame as the **first** message:

- Host (PC): `{ "type": "host-join", "token": "<pcToken>" }` → relay acks with
  `{ "type": "host-join-ack" }`.
- Client (phone): `{ "type": "client-join", "token": "<mobileToken>" }` → if a
  host is online the relay replies `{ "type": "room-ready" }` and pipes;
  otherwise `{ "type": "host-offline" }` and parks the client until a host binds.

When both slots are filled the host also receives `{ "type": "peer-online" }`.
Every frame after the join is forwarded **verbatim** to the paired socket — the
relay never parses the payload.

## CLI

```bash
# Start the relay (reads RELAY_* env vars)
relay-server serve

# Mint a matched token pair bound to a new room
relay-server generate-pair --name "my-mac" --relay-url wss://relay.example.com
#   PC token:     orca-pc_<base64url>   ← paste into desktop
#   Mobile token: orca-mb_<base64url>   ← paste into phone

# Invalidate a pair (rotate / re-pair)
relay-server revoke <roomId>
```

### Environment

| Var | Default | Purpose |
|---|---|---|
| `RELAY_PORT` | `6770` | listen port |
| `RELAY_HOST` | `0.0.0.0` | listen host |
| `RELAY_PUBLIC_URL` | `ws://localhost:<port>` | public `wss://` URL baked into tokens |
| `RELAY_STORE_PATH` | `~/.orca-relay/rooms.json` | hardened (0600) room/token store |
| `RELAY_TLS_CERT_FILE` / `RELAY_TLS_KEY_FILE` | — | optional built-in TLS (otherwise terminate TLS in a proxy) |
| `RELAY_MAX_CONN_PER_IP_PER_MIN` | `60` | per-IP new-connection budget; over-budget sockets are refused with WebSocket `1013` (try again later) |
| `RELAY_MAX_CONCURRENT_CONNECTIONS` | `10000` | global concurrent-socket cap; refused with `1013` |
| `RELAY_TRUST_PROXY` | `false` | read `X-Forwarded-For` for the client IP (set when behind a TLS-terminating proxy, else rate limiting keys on the proxy IP) |

## Health & observability

`GET /healthz` (alias `/metrics`) on the same port returns JSON counters — total
/ rejected connections, host/client joins, supersede + peer-recycle events, and
forwarded message/byte totals — plus live gauges (open sockets, active rooms).
The relay persists **no** forwarded payload; only these connection-level counters
and per-join/close log lines exist. The reference `docker-compose.yml` uses
`/healthz` as the container liveness probe.

```bash
curl -s http://127.0.0.1:6770/healthz | jq
```

## Develop

```bash
npm install        # or pnpm install
npm run dev        # tsx watch serve
npm test           # vitest (two-ws-client end-to-end + unit)
npm run typecheck
npm run build      # emit dist/
```

## Deploy (Docker)

```bash
RELAY_DOMAIN=relay.example.com RELAY_PUBLIC_URL=wss://relay.example.com \
  docker compose up -d --build
# then mint a pair inside the running container:
docker compose exec relay node dist/cli.js generate-pair --name "my-mac"
```

Caddy (in `docker-compose.yml`) terminates TLS and reverse-proxies the WebSocket
upgrade to the relay, so clients only ever dial the public `wss://` URL. The
reference compose sets `RELAY_TRUST_PROXY=true` so per-IP rate limiting keys on
the real client IP (via Caddy's `X-Forwarded-For`) rather than the proxy, and
gates Caddy on the relay's `/healthz` readiness.
