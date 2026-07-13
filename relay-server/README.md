# Orca Relay Server

[中文文档](./README.zh-CN.md)

A small, self-hostable **relay bridge** that lets an Orca desktop and one paired
phone reach each other after the phone leaves the LAN — **without opening any
inbound port on the desktop**. Both the desktop and the phone connect _outbound_
to this relay; the relay forwards opaque, end-to-end-encrypted frames between
them. It is a **dumb byte pipe**: it has no static secret key and therefore
cannot decrypt the traffic it carries.

See the PC-led design doc
[`../docs/mobile-relay-v2-pc-led-design.md`](../docs/mobile-relay-v2-pc-led-design.md).

## Model

Relay v2 is the default model:

- The PC connects first with a configured **relay URL**.
- The relay stores a PC record, channel records, and mobile bindings in the v2
  store.
- A binding channel is created from the PC. If a phone is already bound, the PC
  can keep it or explicitly disconnect and rebind.
- The PC shows a QR invite. The invite contains the relay URL, channel ID, PC
  public key, CA bootstrap data when available, and the desktop E2EE device
  token required after the relay bind step.
- A phone can resume with its `mobileDeviceId` + resume token after network
  changes, app suspension, relay restart, or phone process restart.
- Admin endpoints can list and revoke PC/channel/mobile state without exposing
  secrets.

## Wire protocol

### Relay v2

The first WebSocket frame is JSON with `v: 2`:

- PC: `{ "v": 2, "type": "pc-hello", ... }`.
- PC creates an invite channel with `{ "v": 2, "type": "channel-create", ... }`.
- Phone joins with `{ "v": 2, "type": "mobile-join", ... }` or resumes with
  `{ "v": 2, "type": "mobile-resume", ... }`.

After the relay accepts the join/resume, all subsequent payload frames are still
opaque E2EE/RPC traffic. The relay authorizes and routes the channel; it does
not decrypt desktop/mobile payloads.

## CLI

```bash
# Start the relay (reads RELAY_* env vars)
relay-server serve

# Generate a local CA, iOS trust profile, and server TLS cert for IP-only wss://
relay-server generate-self-signed-ca --host 192.0.2.10 --out-dir ./certs
#   Certificate token: orca-cert_<base64url> ← paste into phone or desktop to install

# Build locally, upload to a remote Linux/POSIX host, and restart the relay
relay-server deploy-remote --config remote.properties

# Relay v2 local admin commands (read/write the local v2 store)
relay-server list-connections
relay-server disconnect-pc <pcId>
relay-server revoke-channel <channelId>
relay-server revoke-mobile <mobileDeviceId>
```

### Self-signed CA for IP-only `wss://`

Use this when the relay is reachable by IP address only, or when you cannot get
a publicly trusted certificate for the relay host. The command generates a local
root CA, a server certificate whose SAN matches the host/IP, and an unsigned iOS
configuration profile containing the CA certificate:

```bash
relay-server generate-self-signed-ca --host 192.0.2.10 --out-dir ./certs
```

Generated files:

| File                         | Purpose                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| `orca-relay-ca.pem`          | local root CA certificate                                   |
| `orca-relay-ca.cer`          | DER CA certificate for manual install/import                |
| `orca-relay-ca.mobileconfig` | iOS/iPadOS configuration profile that installs the CA       |
| `orca-relay-ca.token`        | certificate token for Orca desktop/mobile install bootstrap |
| `orca-relay-server.pem`      | TLS certificate for the relay                               |
| `orca-relay-server-key.pem`  | TLS private key for the relay                               |

The command also prints a `orca-cert_...` certificate token. Paste that token
into Orca Mobile or the desktop **Settings → Mobile** token field to open the
system certificate/profile installer. This is a transport shortcut only: iOS
still requires the user to approve the profile and enable full trust in Settings.

Start the relay with the generated server certificate and a public URL that uses
the same host/IP:

```bash
RELAY_PUBLIC_URL=wss://192.0.2.10:6770 \
RELAY_TLS_CERT_FILE=./certs/orca-relay-server.pem \
RELAY_TLS_KEY_FILE=./certs/orca-relay-server-key.pem \
relay-server serve
```

When the CA files sit next to `RELAY_TLS_CERT_FILE`, the relay also exposes
certificate bootstrap endpoints:

```http
GET /.well-known/orca-relay/ca.cer
GET /.well-known/orca-relay/ca.mobileconfig
GET /.well-known/orca-relay/cert-token
```

These endpoints are only install shortcuts. Clients must still show the user
what will be installed and rely on the OS trust flow; do not silently trust a CA
just because the endpoint is reachable.

For IPv6, pass the bare address to `--host` and use a bracketed URL in
`--relay-url`, for example `--host 2001:db8::10` and
`--relay-url wss://[2001:db8::10]:6770`.

#### Install the CA on iOS/iPadOS

1. Paste the printed `orca-cert_...` token into Orca Mobile, or send
   `orca-relay-ca.mobileconfig` to the iPhone/iPad with AirDrop, Files, or
   Safari.
2. Open the profile on the device.
3. Open **Settings → General → VPN & Device Management** and install the profile.
4. Open **Settings → General → About → Certificate Trust Settings** and enable
   full trust for the Orca Relay CA.

iOS does not allow Orca Mobile to silently install or fully trust a CA
certificate. The profile can carry the certificate to the device, but the user
must still approve installation and enable full trust in Settings. The relay URL
used by relay invites must match the generated certificate SAN exactly; for
IP-only deployments, use the same IP address in `--host` and `RELAY_PUBLIC_URL`.

### Deploy with `remote.properties`

Use this for a simple SSH/SFTP deployment to a remote Linux/POSIX host. The
deploy command builds the local `relay-server`, uploads the configured files to
a timestamped release directory, updates `current`, stops the previous PID, and
starts `node dist/cli.js serve` with the configured `RELAY_*` environment.

```bash
cp remote.properties.example remote.properties
# edit remote.properties
relay-server deploy-remote --config remote.properties
```

When running from source:

```bash
pnpm run deploy-remote -- --config remote.properties
```

`remote.properties` is ignored by git because it may contain passwords. For an
IP-only relay, set `domain=<ip>:<port>` and the deploy command derives the
public URL, relay port, SSH host, local certificate mode, TLS file paths, and
certificate upload path:

```properties
domain=203.0.113.10:6770
ssh.port=22
ssh.username=ubuntu
ssh.password=change-me
# ssh.privateKey=/Users/me/.ssh/id_ed25519
# ssh.passphrase=

remote.dir=/opt/orca-relay
upload.include=dist,package.json,pnpm-lock.yaml

relay.host=0.0.0.0
relay.storePath=/opt/orca-relay/data/rooms.json
relay.trustProxy=false
```

With `domain=203.0.113.10:6770`, `deploy-remote` automatically:

- uses `wss://203.0.113.10:6770` as `RELAY_PUBLIC_URL`;
- uses `6770` as `RELAY_PORT`;
- generates or reuses `./certs` local CA/server TLS material;
- appends `certs` to `upload.include` when needed;
- sets `RELAY_TLS_CERT_FILE` and `RELAY_TLS_KEY_FILE` under
  `/opt/orca-relay/current/certs`;
- prints a `orca-cert_...` token that can be pasted into Orca Mobile or the
  desktop client to launch system certificate installation.

If the SSH target differs from the public relay host, set `ssh.host` explicitly.
For DNS/proxy deployments, use `domain=relay.example.com:443` or
`relay.publicUrl=wss://relay.example.com`, and set `cert.mode=local` only when
you intentionally want local self-signed TLS.

Defaults:

| Property                | Default                                       |
| ----------------------- | --------------------------------------------- |
| `local.buildCommand`    | `npm run build`                               |
| `remote.installCommand` | `npm install --omit=dev --no-audit --no-fund` |
| `remote.nodeCommand`    | `node`                                        |
| `remote.pidFile`        | `<remote.dir>/relay-server.pid`               |
| `remote.logFile`        | `<remote.dir>/relay.log`                      |
| `upload.include`        | `dist,package.json,pnpm-lock.yaml`            |
| `relay.v2StorePath`     | beside `relay.storePath`                      |
| `relay.adminToken`      | unset                                         |

Custom process managers can override the stop/start commands. Placeholders
available in those commands: `{remoteDir}`, `{releasesDir}`, `{releaseDir}`,
`{currentDir}`, `{pidFile}`, `{logFile}`, `{env}`.

### Environment

| Var                                          | Default                    | Purpose                                                                                                                     |
| -------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `RELAY_PORT`                                 | `6770`                     | listen port                                                                                                                 |
| `RELAY_HOST`                                 | `0.0.0.0`                  | listen host                                                                                                                 |
| `RELAY_PUBLIC_URL`                           | `ws://localhost:<port>`    | public `wss://` URL baked into tokens                                                                                       |
| `RELAY_ACCESS_TOKEN`                         | —                          | **required** shared secret presented by each PC during `pc-hello`; generate a long random value and keep it out of source control |
| `RELAY_STORE_PATH`                           | `~/.orca-relay/rooms.json` | hardened (0600) room/token store                                                                                            |
| `RELAY_V2_STORE_PATH`                        | beside `RELAY_STORE_PATH`  | relay v2 PC/channel/mobile metadata store                                                                                   |
| `RELAY_ADMIN_TOKEN`                          | —                          | enables bearer-authenticated `/admin/*` endpoints                                                                           |
| `RELAY_TLS_CERT_FILE` / `RELAY_TLS_KEY_FILE` | —                          | optional built-in TLS (otherwise terminate TLS in a proxy)                                                                  |
| `RELAY_CA_CERT_FILE`                         | beside TLS cert            | DER CA certificate for discovery endpoint                                                                                   |
| `RELAY_CA_MOBILECONFIG_FILE`                 | beside TLS cert            | iOS profile for discovery endpoint                                                                                          |
| `RELAY_CERT_TOKEN_FILE`                      | beside TLS cert            | certificate token for discovery endpoint                                                                                    |
| `RELAY_MAX_CONN_PER_IP_PER_MIN`              | `60`                       | per-IP new-connection budget; over-budget sockets are refused with WebSocket `1013` (try again later)                       |
| `RELAY_MAX_CONCURRENT_CONNECTIONS`           | `10000`                    | global concurrent-socket cap; refused with `1013`                                                                           |
| `RELAY_TRUST_PROXY`                          | `false`                    | read `X-Forwarded-For` for the client IP (set when behind a TLS-terminating proxy, else rate limiting keys on the proxy IP) |

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

### Relay v2 admin API

Set `RELAY_ADMIN_TOKEN` to enable the admin endpoints. Requests must include
`Authorization: Bearer <token>`.

```bash
curl -H "Authorization: Bearer $RELAY_ADMIN_TOKEN" \
  http://127.0.0.1:6770/admin/connections | jq

curl -X POST -H "Authorization: Bearer $RELAY_ADMIN_TOKEN" \
  http://127.0.0.1:6770/admin/mobiles/mobile_123/revoke
```

Supported routes:

| Route                                        | Purpose                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `GET /admin/connections`                     | list sanitized PC/channel/mobile metadata      |
| `POST /admin/pcs/:pcId/disconnect`           | disconnect a live PC and mark it offline       |
| `POST /admin/channels/:channelId/revoke`     | revoke a channel and associated mobile binding |
| `POST /admin/mobiles/:mobileDeviceId/revoke` | revoke a mobile binding                        |

Admin responses never include `pcSecret`, invite/resume tokens, or token hashes.

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
```

Caddy (in `docker-compose.yml`) terminates TLS and reverse-proxies the WebSocket
upgrade to the relay, so clients only ever dial the public `wss://` URL. The
reference compose sets `RELAY_TRUST_PROXY=true` so per-IP rate limiting keys on
the real client IP (via Caddy's `X-Forwarded-For`) rather than the proxy, and
gates Caddy on the relay's `/healthz` readiness.
