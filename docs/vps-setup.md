# 自建 VPS 与出口模式

网站维护机场、VLESS REALITY 节点及 Webshare 参数，Clash 手动决定实际使用方式。
新增 VPS 不会自动切换电脑出口。没有可用代理节点前，仅有主机 IP 和 SSH 信息不能作为 Clash 节点。

| 使用方式 | Clash 选择 | 最终出口 |
| --- | --- | --- |
| 机场 + Webshare | 使用方案 → 机场＋Webshare；机场节点 → 选地区 | Webshare |
| VPS + Webshare | 使用方案 → VPS＋Webshare | Webshare |
| VPS 单独使用 | 使用方案 → 只用 VPS | VPS |
| 机场单独使用 | 使用方案 → 只用机场；机场节点 → 选地区 | 所选机场节点 |

Clash 仅展示「使用方案」「机场节点」及多台 VPS 时的「VPS 节点」。四个方案的内部
连接组隐藏，Webshare 接入方式在网站维护。只有一台 VPS 时自动引用它。
默认优先机场＋Webshare，没有机场时为 VPS＋Webshare；没有自动故障回退。
普通代理规则、默认流量及 AI 专用端口跟随同一个「使用方案」。手动选择只用 VPS / 机场
会改变 AI 出口。国内直连规则只作用于普通规则端口。

网站「更换配置」提供三个入口，参数保存发布后沿用原订阅地址，在 Clash 刷新一次。
Webshare 可粘贴官网 curl、HTTP / SOCKS5 URL 或 地址:端口:用户名:密码，浏览器内解析。
Direct / Backbone 参数分别保留，发布时选定一个供两个 Webshare 方案共用。
网站没有本机控制通道，不报告本机已应用或实测通过。

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
密码库使用 `legend-vps` 登录条目的密码字段。不存在该条目时由用户在自己的
密码库界面填写；需要解锁时在用户 Terminal 运行现有解锁工具。

```sh
/Users/pygmalion/Documents/Codex/Projects/008-bitwarden-codex/bw-codex run \
  scripts/legend-bitwarden.example.json -- \
  python3 scripts/vps-bootstrap.py --output data/legend-vps --deploy
```

部署脚本经 SSH 标准输入传配置，密码仅通过环境与 SSH askpass 内部传递；不写磁盘或命令参数。
它会检查端口冲突、拒绝覆盖非本项目配置，从官方发布下载 Linux 二进制并核验 SHA256，
检查配置后启动 `route-policy-xray.service`。默认监听 TCP 443，以专用系统账户 route-hub-xray 运行，仅赋予绑定低端口能力。
不修改 SSH 登录策略或系统防火墙。主机防火墙或服务商防火墙阻断时，需依据真实失败再处理。
服务器端拒绝访问私有 / 本地网段，不提供无认证 SOCKS 或 HTTP 入口。

部署完的状态仍标记 `service-active-client-unverified`。完成真实客户端验收后，才把私有节点链接
加入网站「自建 VPS」，刷新日常订阅并选择相应模式。

## 必须完成的真实验收

1. 独立 Mihomo 配置分别测试 VPS 直出和 VPS + Webshare，确认最终 IP。
2. 重复请求目标 AI 服务、GitHub 原始文件和普通 HTTPS，记录完整请求耗时与超时；401 只表示接口可达，不表示登录或生成成功。
3. 对所选模式制造测试故障，确认请求失败且没有自动改走其他出口。
4. 验证后才切换日常连接；保留原订阅和当前机场节点作为手动恢复路径。

## 本次部署与验收（2026-10-18）

已通过密码库 `legend-vps` 登录并核对服务器身份，安装官方 Xray 服务。
REALITY 的 Microsoft 目标在本次环境下导致握手失败；更换为 Apple 目标后真实请求成功，
部署脚本默认目标同步修正。服务使用专用系统账户，日志恢复 warning。

密码库应看 `codex_authorized`：普通 `cli_status: locked` 不代表 Codex 钥匙串会话无效；
本次 `codex_authorized: true`，无需用户重复解锁。

使用独立 Mihomo 通过物理网络连接 VPS，服务重启完成后分别执行五轮、每轮四个 HTTPS 请求：

| 路径 | 出口检查 | GitHub 中位数 | Anthropic 中位数 | OpenAI 中位数 | 超时 / 失败 |
| --- | --- | --- | --- | --- | --- |
| VPS 直出 | 五次均为购买的 VPS IPv4 | 0.91 秒 | 0.68 秒 | 1.10 秒 | 0 / 0 |
| VPS + Webshare | 五次均为原 Webshare IPv4 | 2.74 秒 | 2.08 秒 | 2.12 秒 | 0 / 0 |

AI 接口返回 401，只证明 HTTPS/API 可达；未登录 Claude / OpenAI 账号执行生成。
这是一次短时样本，不能据此保证长期稳定或账号风控结果。原始报告只保存在忽略的 `data/`。
服务调整期间的初轮请求有一次被重启中断，上表使用服务调整完成后的整轮结果。

参考：[Xray REALITY](https://xtls.github.io/en/config/transports/reality.html)、
[Mihomo VLESS](https://wiki.metacubex.one/en/config/proxies/vless/)、
[官方发布](https://github.com/XTLS/Xray-core/releases/tag/v26.3.27)。

## 测量脚本

`scripts/measure-proxy.py` 只通过指定的本机代理重复实际 HTTPS 请求，不切换线路，
记录状态码、连接 / TLS / 总耗时、超时数量、中位数和小样本 p95，报告写入私有 `data/`：

```sh
python3 scripts/measure-proxy.py --proxy http://127.0.0.1:18998 --rounds 5
```

默认 18998 是隔离测试端口，需要先启动相应测试内核；不要把它当作日常端口。
17897 可测试当前手动选择的 AI 出口。本次两种 Legend 路径的验收结果见上表。没有把 401 或 IP 风险分数当作账号生成成功。

先前 Microsoft 目标下的握手失败已在真实 VPS 定位并通过更换目标解决。
节点已添加到 NAS 的「自建 VPS」。日常默认固定 Webshare，切换方式见文首表格。

隔离测试中将 VPS 地址改为不可达后，VPS 直出和 VPS + Webshare 都按预期失败，没有自动切换出口。
Clash 已刷新并核对实际运行节点与已验证材料一致；本次简化前选择固定出口 + 前置机场。
AI 专用端口确认保留原固定出口，Magpie 网关未登录检查为 401。
用户报告刷新附近发生过 502 并由 OpenCode 修复，本次未取得该故障根因证据，不能据恢复状态断言已彻底根治。
