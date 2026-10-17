# 自建 VPS 与出口模式

网站维护机场、VLESS REALITY 节点及 Webshare 参数，Clash 手动决定实际使用方式。
新增 VPS 不会自动切换电脑出口。没有可用代理节点前，仅有主机 IP 和 SSH 信息不能作为 Clash 节点。

| 使用方式 | Clash 选择 | 最终出口 |
| --- | --- | --- |
| 机场 + Webshare | 出口模式 → 固定出口；前置线路 → 前置机场 | Webshare |
| VPS + Webshare | 出口模式 → 固定出口；前置线路 → 自建 VPS | Webshare |
| VPS 单独使用 | 出口模式 → VPS 直出 | VPS |
| 机场单独使用 | 出口模式 → 机场直出 | 所选机场节点 |

默认仍为固定 Webshare；没有自动故障回退。普通代理规则、默认流量及 AI 专用端口
跟随同一个「出口模式」。手动选择直出会明确改变 AI 出口，而非保留旧固定 IP。
国内直连规则只作用于普通规则端口，AI 专用端口不按这些规则直连。

## 准备与部署

`scripts/vps-bootstrap.py` 为一台 VPS 生成私有配置，使用 Xray 官方 `v26.3.27` 的
VLESS / RAW / REALITY / Vision，不需要先购买或绑定域名。
该版本与资产校验方式在本次读取官方仓库后固定，不会自动追随最新版。

```sh
python3 scripts/vps-bootstrap.py --host VPS_IP --ssh-port 61234 --output data/legend-vps
```

生成的 `server.json`、`client-node.json`、`client-link.txt` 和 `inventory.json` 都只在
忽略目录，文件权限 0600，目录 0700。已有材料会复用，不重新生成密钥。
不要把节点链接、UUID、REALITY 客户端材料或服务器私钥放进聊天或 Git。

首次安装需要已获授权的 SSH 密钥，或密码库注入的 `VPS_SSH_PASSWORD`。
密码库使用 `codex/legend-vps` 登录条目的密码字段。不存在该条目时由用户在自己的
密码库界面填写；需要解锁时在用户 Terminal 运行现有解锁工具。

```sh
/Users/pygmalion/Documents/Codex/Projects/008-bitwarden-codex/bw-codex run \
  scripts/legend-bitwarden.example.json -- \
  python3 scripts/vps-bootstrap.py --output data/legend-vps --deploy
```

部署脚本经 SSH 标准输入传配置，密码仅通过环境与 SSH askpass 内部传递；不写磁盘或命令参数。
它会检查端口冲突、拒绝覆盖非本项目配置，从官方发布下载 Linux 二进制并核验 SHA256，
检查配置后启动 `route-policy-xray.service`。默认监听 TCP 443，以 nobody 运行，仅赋予绑定低端口能力。
不修改 SSH 登录策略或系统防火墙。主机防火墙或服务商防火墙阻断时，需依据真实失败再处理。
服务器端拒绝访问私有 / 本地网段，不提供无认证 SOCKS 或 HTTP 入口。

部署完的状态仍标记 `service-active-client-unverified`。完成真实客户端验收后，才把私有节点链接
加入网站「自建 VPS」，刷新日常订阅并选择相应模式。

## 必须完成的真实验收

1. 独立 Mihomo 配置分别测试 VPS 直出和 VPS + Webshare，确认最终 IP。
2. 重复请求目标 AI 服务、GitHub 原始文件和普通 HTTPS，记录完整请求耗时与超时；401 只表示接口可达，不表示登录或生成成功。
3. 对所选模式制造测试故障，确认请求失败且没有自动改走其他出口。
4. 验证后才切换日常连接；保留原订阅和当前机场节点作为手动恢复路径。

## 本次准备状态

Legend 的 SSH 服务已响应，但当前没有可用登录凭据：已有默认 SSH 密钥被拒绝，
自托管密码库锁定，浏览器没有 Legend 登录会话。未登录服务器、未安装代理、未测出 VPS 的真实代理延迟。
本机已生成一套私有材料并检查官方 Xray 能解析服务端配置；这不等于 VPS 已部署或可用。

参考：[Xray REALITY](https://xtls.github.io/en/config/transports/reality.html)、
[Mihomo VLESS](https://wiki.metacubex.one/en/config/proxies/vless/)、
[官方发布](https://github.com/XTLS/Xray-core/releases/tag/v26.3.27)。
