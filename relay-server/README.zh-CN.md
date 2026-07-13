# Orca Relay Server

[English](./README.md)

Orca Relay Server 是一个小型、可自托管的**中继桥**。当手机离开局域网后，它让 Orca 桌面端和已配对的手机仍然可以互相连接，且**不需要在桌面端开放任何入站端口**。桌面端和手机都会主动向 relay 发起出站连接；relay 只转发两端之间的端到端加密帧。

它是一个**只搬运字节的管道**：relay 没有静态密钥，也无法解密自己转发的流量。

PC 主导设计见
[`../docs/mobile-relay-v2-pc-led-design.md`](../docs/mobile-relay-v2-pc-led-design.md)。

## 模型

Relay v2 是默认模型：

- PC 先配置 **relay URL** 并主动连接 relay。
- relay 在 v2 store 中保存 PC、channel 和 mobile binding 元数据。
- 绑定 channel 由 PC 创建。如果已经有手机绑定，PC 可以保持现状，也可以明确断开后重新绑定。
- PC 显示二维码 invite。invite 包含 relay URL、channel ID、PC public key、可用时的 CA 安装引导信息，以及 relay bind 之后 E2EE/RPC 还需要用到的 desktop device token。
- 手机在网络变化、App 被挂起、relay 重启或手机进程重启后，可以通过 `mobileDeviceId` + resume token 恢复。
- Admin API 可以查看和撤销 PC/channel/mobile 状态，但不会暴露 secret。

## 线协议

### Relay v2

WebSocket 第一帧是带 `v: 2` 的 JSON：

- PC：`{ "v": 2, "type": "pc-hello", ... }`。
- PC 通过 `{ "v": 2, "type": "channel-create", ... }` 创建 invite channel。
- 手机通过 `{ "v": 2, "type": "mobile-join", ... }` 首次加入，或通过
  `{ "v": 2, "type": "mobile-resume", ... }` 恢复。

relay 接受 join/resume 后，后续 payload 仍然是不透明的 E2EE/RPC 流量。relay 只负责
授权和路由 channel，不解密桌面端/手机端 payload。

## CLI

```bash
# 启动 relay，读取 RELAY_* 环境变量
relay-server serve

# 为仅 IP 的 wss:// 生成本地 CA、iOS 信任配置描述文件和服务端 TLS 证书
relay-server generate-self-signed-ca --host 192.0.2.10 --out-dir ./certs
#   Certificate token: orca-cert_<base64url> ← 粘贴到手机端或桌面端安装证书

# 本地构建，上传到远程 Linux/POSIX 主机，并重启 relay
relay-server deploy-remote --config remote.properties

# Relay v2 本地管理命令（读写本地 v2 store）
relay-server list-connections
relay-server disconnect-pc <pcId>
relay-server revoke-channel <channelId>
relay-server revoke-mobile <mobileDeviceId>
```

### 仅 IP `wss://` 的自签 CA

当 relay 只能通过 IP 地址访问，或无法为 relay host 获取公开可信证书时，可以使用这个命令。它会生成一个本地 Root CA、一个 SAN 匹配 host/IP 的服务端证书，以及一个未签名的 iOS 配置描述文件，配置描述文件里包含 CA 证书：

```bash
relay-server generate-self-signed-ca --host 192.0.2.10 --out-dir ./certs
```

生成的文件：

| 文件                         | 用途                                 |
| ---------------------------- | ------------------------------------ |
| `orca-relay-ca.pem`          | 本地 Root CA 证书                    |
| `orca-relay-ca.cer`          | DER 格式 CA 证书，用于手动安装或导入 |
| `orca-relay-ca.mobileconfig` | iOS/iPadOS 配置描述文件，用于安装 CA |
| `orca-relay-ca.token`        | Orca 桌面端/手机端证书安装引导 token |
| `orca-relay-server.pem`      | relay 的 TLS 证书                    |
| `orca-relay-server-key.pem`  | relay 的 TLS 私钥                    |

命令还会输出一个 `orca-cert_...` 证书 token。把它粘贴到 Orca Mobile，或桌面端 **Settings → Mobile** 的 token 输入框中，即可拉起系统证书/描述文件安装流程。它只是省掉手动传文件这一步：iOS 仍然要求用户在 Settings 里确认安装 profile，并为 CA 启用 full trust。

使用生成的服务端证书启动 relay，public URL 必须使用同一个 host/IP：

```bash
RELAY_PUBLIC_URL=wss://192.0.2.10:6770 \
RELAY_TLS_CERT_FILE=./certs/orca-relay-server.pem \
RELAY_TLS_KEY_FILE=./certs/orca-relay-server-key.pem \
relay-server serve
```

如果 CA 文件和 `RELAY_TLS_CERT_FILE` 位于同一目录，relay 还会暴露证书安装引导接口：

```http
GET /.well-known/orca-relay/ca.cer
GET /.well-known/orca-relay/ca.mobileconfig
GET /.well-known/orca-relay/cert-token
```

这些接口只用于减少手动传文件步骤。客户端仍必须明确提示用户即将安装的内容，并走系统信任流程；不能因为 endpoint 可访问就静默信任 CA。

IPv6 场景下，`--host` 传裸地址，`--relay-url` 使用带方括号的 URL，例如 `--host 2001:db8::10` 和 `--relay-url wss://[2001:db8::10]:6770`。

#### 在 iOS/iPadOS 上安装 CA

1. 将输出的 `orca-cert_...` token 粘贴到 Orca Mobile，或通过 AirDrop、Files、Safari 等方式把 `orca-relay-ca.mobileconfig` 发送到 iPhone/iPad。
2. 在设备上打开该配置描述文件。
3. 打开 **Settings → General → VPN & Device Management** 并安装 profile。
4. 打开 **Settings → General → About → Certificate Trust Settings**，为 Orca Relay CA 启用 full trust。

iOS 不允许 Orca Mobile 静默安装 CA 证书，也不允许 App 静默启用完全信任。配置描述文件只能把证书带到设备上，用户仍然必须在 Settings 中确认安装并启用 full trust。relay invite 使用的 relay URL 必须和生成证书时的 SAN 完全匹配；仅 IP 部署时，`--host` 和 `RELAY_PUBLIC_URL` 都要使用同一个 IP 地址。

### 使用 `remote.properties` 部署

这个流程适合通过 SSH/SFTP 部署到远程 Linux/POSIX 主机。部署命令会先构建本地 `relay-server`，再把配置的文件上传到带时间戳的 release 目录，更新 `current`，停止旧 PID，并使用配置好的 `RELAY_*` 环境变量启动 `node dist/cli.js serve`。

```bash
cp remote.properties.example remote.properties
# 编辑 remote.properties
relay-server deploy-remote --config remote.properties
```

从源码运行时：

```bash
pnpm run deploy-remote -- --config remote.properties
```

`remote.properties` 已被 git 忽略，因为其中可能包含密码。仅 IP relay 推荐只写 `domain=<ip>:<port>`；部署命令会从这里推导 public URL、relay 端口、SSH host、本地证书模式、TLS 文件路径和证书上传路径：

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

当配置 `domain=203.0.113.10:6770` 时，`deploy-remote` 会自动：

- 使用 `wss://203.0.113.10:6770` 作为 `RELAY_PUBLIC_URL`；
- 使用 `6770` 作为 `RELAY_PORT`；
- 生成或复用 `./certs` 里的本地 CA 和服务端 TLS 证书；
- 在需要时把 `certs` 自动追加到 `upload.include`；
- 把 `RELAY_TLS_CERT_FILE` 和 `RELAY_TLS_KEY_FILE` 指向 `/opt/orca-relay/current/certs` 下的文件；
- 输出一个 `orca-cert_...` token，可直接粘贴到 Orca Mobile 或桌面端，拉起系统证书安装。

如果 SSH 登录地址和公开 relay host 不同，再单独设置 `ssh.host`。如果是 DNS/反代部署，可以使用 `domain=relay.example.com:443` 或 `relay.publicUrl=wss://relay.example.com`；只有明确要使用本地自签 TLS 时才设置 `cert.mode=local`。

默认值：

| Property                | Default                                       |
| ----------------------- | --------------------------------------------- |
| `local.buildCommand`    | `npm run build`                               |
| `remote.installCommand` | `npm install --omit=dev --no-audit --no-fund` |
| `remote.nodeCommand`    | `node`                                        |
| `remote.pidFile`        | `<remote.dir>/relay-server.pid`               |
| `remote.logFile`        | `<remote.dir>/relay.log`                      |
| `upload.include`        | `dist,package.json,pnpm-lock.yaml`            |
| `relay.v2StorePath`     | 位于 `relay.storePath` 同目录                 |
| `relay.adminToken`      | 未设置                                        |

如果远端使用 systemd、supervisor 或其他进程管理器，可以覆盖 stop/start 命令。可用占位符：`{remoteDir}`、`{releasesDir}`、`{releaseDir}`、`{currentDir}`、`{pidFile}`、`{logFile}`、`{env}`。

### 环境变量

| 变量                                         | 默认值                         | 用途                                                                                      |
| -------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `RELAY_PORT`                                 | `6770`                         | 监听端口                                                                                  |
| `RELAY_HOST`                                 | `0.0.0.0`                      | 监听地址                                                                                  |
| `RELAY_PUBLIC_URL`                           | `ws://localhost:<port>`        | 写入 token 的公网 `wss://` URL                                                            |
| `RELAY_STORE_PATH`                           | `~/.orca-relay/rooms.json`     | room/token 存储文件，权限加固为 0600                                                      |
| `RELAY_V2_STORE_PATH`                        | 位于 `RELAY_STORE_PATH` 同目录 | relay v2 PC/channel/mobile 元数据 store                                                   |
| `RELAY_ADMIN_TOKEN`                          | —                              | 启用 Bearer 鉴权的 `/admin/*` 接口                                                        |
| `RELAY_TLS_CERT_FILE` / `RELAY_TLS_KEY_FILE` | —                              | 可选的内置 TLS；否则应在代理层终止 TLS                                                    |
| `RELAY_CA_CERT_FILE`                         | TLS 证书同目录                 | discovery endpoint 使用的 DER CA 证书                                                     |
| `RELAY_CA_MOBILECONFIG_FILE`                 | TLS 证书同目录                 | discovery endpoint 使用的 iOS 配置描述文件                                                |
| `RELAY_CERT_TOKEN_FILE`                      | TLS 证书同目录                 | discovery endpoint 使用的证书 token                                                       |
| `RELAY_MAX_CONN_PER_IP_PER_MIN`              | `60`                           | 每个 IP 每分钟新建连接预算；超限 socket 会以 WebSocket `1013` 拒绝                        |
| `RELAY_MAX_CONCURRENT_CONNECTIONS`           | `10000`                        | 全局并发 socket 上限；超限以 `1013` 拒绝                                                  |
| `RELAY_TRUST_PROXY`                          | `false`                        | 从 `X-Forwarded-For` 读取客户端 IP；位于 TLS 终止代理后方时启用，否则限流会按代理 IP 计数 |

## 健康检查和可观测性

同一端口上的 `GET /healthz`（别名 `/metrics`）会返回 JSON 计数器：总连接数、拒绝连接数、host/client join 数、supersede/peer-recycle 事件、转发消息数和字节数，以及实时 gauge（open sockets、active rooms）。

relay **不持久化**任何被转发的 payload；只保留这些连接级计数器和 join/close 日志。参考 `docker-compose.yml` 使用 `/healthz` 作为容器存活探针。

```bash
curl -s http://127.0.0.1:6770/healthz | jq
```

### Relay v2 Admin API

设置 `RELAY_ADMIN_TOKEN` 后会启用 admin 接口。请求必须带
`Authorization: Bearer <token>`。

```bash
curl -H "Authorization: Bearer $RELAY_ADMIN_TOKEN" \
  http://127.0.0.1:6770/admin/connections | jq

curl -X POST -H "Authorization: Bearer $RELAY_ADMIN_TOKEN" \
  http://127.0.0.1:6770/admin/mobiles/mobile_123/revoke
```

支持的接口：

| Route                                        | 用途                                  |
| -------------------------------------------- | ------------------------------------- |
| `GET /admin/connections`                     | 查看脱敏后的 PC/channel/mobile 元数据 |
| `POST /admin/pcs/:pcId/disconnect`           | 断开在线 PC，并将其标记为 offline     |
| `POST /admin/channels/:channelId/revoke`     | 撤销 channel 和关联 mobile binding    |
| `POST /admin/mobiles/:mobileDeviceId/revoke` | 撤销 mobile binding                   |

Admin 响应不会返回 `pcSecret`、invite/resume token 或任何 token hash。

## 开发

```bash
npm install        # 或 pnpm install
npm run dev        # tsx watch serve
npm test           # vitest（双 WS client 端到端测试 + 单元测试）
npm run typecheck
npm run build      # 输出 dist/
```

## 部署（Docker）

```bash
RELAY_DOMAIN=relay.example.com RELAY_PUBLIC_URL=wss://relay.example.com \
  docker compose up -d --build
```

`docker-compose.yml` 中的 Caddy 负责终止 TLS，并把 WebSocket upgrade 反向代理到 relay，因此客户端只需要连接公网 `wss://` URL。参考 compose 配置会设置 `RELAY_TRUST_PROXY=true`，让每 IP 限流基于 Caddy 设置的真实客户端 IP（`X-Forwarded-For`），而不是把所有客户端都算到代理 IP 上；Caddy 也会等待 relay 的 `/healthz` 就绪。
