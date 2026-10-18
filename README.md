# 004-route-policy-hub

中文产品名：**网络管理**（原分流清单）。

这是一个运行在 NAS 上的私人规则管理页面。管理日常上网的国内直连例外、Claude 专用固定出口，并集中维护机场订阅与 Webshare 固定出口，自动输出 Mihomo / Clash 可更新的规则集和完整配置。

## 极空间 Q4 部署

推荐直接运行 GitHub 自动构建的成品镜像，Q4 不需要安装依赖或现场编译：

1. 在 Q4 创建 Compose 项目目录 `/M.2存储11/route-policy-hub`。
2. 使用 `compose.prebuilt.yaml` 的内容创建项目。
3. 勾选“添加.env”，由设备所有者亲自填写：

   ```dotenv
   ADMIN_PASSWORD=请设置一个仅用于分流清单的管理密码
   ```

4. 创建并启动后，访问 `http://192.168.5.7:8787`。

每次推送到 `main`，GitHub Actions 都会重新构建适用于 Q4 的 AMD64 镜像并发布为
`ghcr.io/pygmalion03/004-route-policy-hub:latest`。Q4 更新时只需重新拉取镜像并
重建容器，`./data` 中的清单不会丢失。

Q4 创建的项目目录默认不允许镜像内的普通用户写入，因此预构建配置仅对这个
受限容器使用 `user: "0:0"`。容器仍为只读根文件系统、移除全部 Linux capabilities，
并只能持久写入项目的 `./data` 目录。

### 在 Q4 本地构建（备用）

1. 将本目录上传到极空间，例如放到 `Docker/route-list`。
2. 如需管理密码，将 `.env.example` 复制为 `.env`，并修改 `ADMIN_PASSWORD`。
3. 在该目录执行：

   ```bash
   docker compose up -d --build
   ```

   如果 NAS 无法直接访问 Docker Hub，可在构建时指定镜像前缀，而无需修改
   Docker 的全局设置：

   ```bash
   docker compose build --build-arg NODE_IMAGE=m.daocloud.io/docker.io/library/node:22-bookworm-slim
   docker compose up -d
   ```

4. 家中访问 `http://极空间局域网IP:8787`；外出时使用 `http://极空间Tailscale地址:8787`。

数据保存在 `./data/policies.json`。更新容器不会覆盖该文件，备份这个目录即可保留清单。

所有电脑和手机访问的是 NAS 上同一份清单：页面打开时、重新回到页面时以及每 30 秒都会检查更新。两台设备同时修改时，服务端会拒绝旧版本覆盖，并把最新清单返回给较晚保存的一方。

## Clash Verge Rev 接入

已有日常完整订阅无需重复接入，国内直连网站在 `/policies` 添加或移除。其他客户端可手动配置 Mihomo rule providers，分别映射到 DIRECT 和已有代理策略组。

生成的规则提供器约每五分钟获取：

- `/rules/direct.yaml`：直连规则；
- `/rules/proxy.yaml`：代理规则。

规则地址保持只读，不包含节点订阅、密码或 Token。管理密码只保护修改接口，并保存在当前浏览器会话中。

## 本地开发

```bash
pnpm install --ignore-scripts
pnpm dev
```

访问 `http://localhost:3000`。

## 机场与固定出口管理

`/connections` 使用与分流清单相同的管理密码。可以添加 / 删除机场、替换订阅地址，
修改 Webshare Direct / Backbone 的地址、端口、协议及凭据。空白订阅地址或密码保留
已保存的值；读取接口不回传这两类秘密。新增 / 更换机场时，服务端必须能下载该
Clash / Mihomo 订阅，成功后保存节点快照，以完整配置直接提供给客户端，避免首次启动依赖机场订阅下载通道。客户端下载配置时，服务端检查距上次节点刷新是否满一小时，满足时刷新节点；下载失败保留上次成功的节点，并在管理页面提示。

首次配置可以从本机已经验证的日常配置导入（脚本依赖 macOS 自带 Ruby）：

```bash
python3 scripts/import-clash.py /absolute/path/to/daily.yaml --data-dir /absolute/path/to/private-data
```

配置及节点凭据保存于 `DATA_DIR/connections.json`，权限为 `0600`。备份时同时保护
这个文件。订阅下载地址由独立的随机令牌保护，不能分享、公开存储或记录完整请求
URL。连接配置接口在未设置 `ADMIN_PASSWORD` 时拒绝访问；不要把管理密码用于
Clash 订阅令牌。

在页面复制专用配置地址，导入官方 Clash Verge Rev。日常在 Clash 的「使用方案」选择四种路径，需要机场时在「机场节点」选地区。
日常规则模式下国内自动直连，国外走「使用方案」；网站例外优先于自动判断。机场 / VPS / Webshare 参数修改后更新这份配置，
直连 / 代理规则通过既有只读 Mihomo rule providers 每 5 分钟更新。AI 专用代理
监听 `127.0.0.1:17897`，不应用国内直连名单；它与默认代理流量共同跟随手动选择的「使用方案」。
「使用方案」可选择 Webshare 链路、只用 VPS 或只用机场，代理失败时不会自动回退直连。

网站运行于 NAS，维护规则与分发配置，不承担旁路由转发。设置 `PUBLIC_BASE_URL`
为客户端实际访问的 HTTPS 域名，避免反向代理下产生内部地址。管理入口保持 LAN /
Tailscale；若启用 Cloudflare Tunnel 公网入口，先设置认证，订阅和只读规则路径
必须允许 Clash 无交互获取，管理 API 则始终要求管理密码。请勿为整个站点开启
缓存，也不要为订阅请求启用包含完整 URL 的访问日志。

## 页面与更新节奏

- `/`：Claude 专用固定出口配置与安全启动入口；不表示本机实时保护或账号生成状态。
- `/connections`：机场、VPS 与 Webshare 参数管理；更新异常直接显示，连接改变时提醒 Claude 独立副本尚未同步。方案说明默认折叠，秘密字段不回显。
- `/policies`：网站例外，管理强制直连、强制日常代理的网站与 UU 远程进程规则。既有只读规则 API 路径不变。

同一标签页沿用现有管理密码会话；Cloudflare Access 仍保护管理页面。
当前 Mac 的完整订阅自动下载间隔为一天，连接修改后手动刷新；规则独立约五分钟获取。
页面仅能确认保存到 NAS，不能声称所有客户端已经应用。网站不替用户切换机场、地区或 Webshare IP。

## 自建 VPS

连接页面支持添加 VLESS REALITY / TCP / Vision 节点链接，留空保留既有节点凭据，
读取时不回传链接、UUID 或 REALITY 客户端材料。没有机场时也可单独保留 VPS。
「使用方案」统一控制普通代理流量与现有 AI 端口 17897：机场＋Webshare、VPS＋Webshare、
只用 VPS、只用机场。内部连接组隐藏，只有一台 VPS 时无需再选节点。

部署与验收步骤见 [自建 VPS 接入](docs/vps-setup.md)。主机 IP 和 SSH 端口不是代理节点；
Legend 已通过密码库登录并部署，VPS 直出与 VPS＋Webshare 均完成真实 HTTPS 验收；
结果与限制见接入文档。

## Claude Code 专用网络（Apple Silicon Mac）

Clash 日常保持激活「日常网络 · 网站管理」。首页发布专用配置后刷新这份订阅；无需重新导入。`127.0.0.1:17997` 使用独立保存的 VPS 直出或 VPS → Webshare 参数，不跟随日常方案或直连例外。日常参数改变不会覆盖这个副本，网站会提醒核对后单独更新。切换整份订阅或重启 Clash 仍可能中断连接。

```bash
./scripts/claude-safe.command
```

本机也可直接打开 `~/Applications/Claude 项目启动器.app`，选择 Mac 项目文件夹后在 Terminal 启动，无需输入命令；应用内另有「打开专用 Edge / 登录」按钮。重新安装入口：`python3 scripts/install-claude-project.py`。命令行可用 `./scripts/claude-safe.command --project /absolute/project/path` 指定目录。

专用启动使用目录内自动编辑（acceptEdits），不加载用户 / 项目的 settings、插件钩子或外部 MCP，只加载启动器自己的文件授权 Hook，不自动连接浏览器；既有设置文件不改动。外层 macOS 限制阻止读取项目外的个人主目录文件、写入项目外文件及发送 Apple Events；Claude 自身运行文件、状态目录和临时目录保留必要访问。这是有限的进程约束，不是虚拟机或整机隔离。项目中的代码与秘密文件仍需自行管理。直接运行 `claude` 不具备这些启动限制。

启动器先核对实际出口，再使用 macOS 网络限制启动 Claude Code 及其子进程：只允许连接本机 17997，代理失败或出口不符时拒绝启动。直接执行 `claude` 不具备这层限制。子进程需要其他网络时也会受此限制。

浏览器使用本机应用「Claude 专用 Edge」，保持 Clash 与 LuLu 运行。LuLu 只允许 Edge 连接专用端口；已实测代理关闭时网页失败，恢复后仍为固定出口，访问普通本机代理端口被阻止。旧本地 Edge 资料由用户删除，专用资料未导入旧账号、书签或密码。

应用里的「检查网络」或 `./scripts/claude-check.command` 会显示实际出口、LuLu 规则检查和 Anthropic HTTPS 首响应时间；401 只表示未认证请求获得响应。网站不读取本机实时状态。命令行登录地址只留在本机等待专用浏览器处理；账号注册、登录及实际生成仍需本人验收。网络配置无法保证账号不被限制。

两份旧 Webshare 本地配置已备份后移出订阅列表，雪山、拼好连、ToLink 原订阅标为备用。私人恢复材料在忽略目录 `data/usability-backup`，不要分享或提交。

## 日常与远程开发边界

日常规则顺序为：管理域名、局域网与 Tailscale → 手动直连例外 → 手动代理例外 → 国内域名 → 国内 IP → 使用方案。国内规则使用 MetaCubeX 的 cn.mrs，每日更新；下载经日常使用方案，国内识别失败时余下流量仍走代理。`17897` 保持原来的日常代理语义，`17997` 仍固定 Claude 出口，不参与日常分流。

Mac 的 SSH/Mutagen 经 Tailscale 连接 WSL，普通开发不经过 Claude 沙箱。Claude 外层 macOS 限制现在默认拒绝所有出站连接（包含 Unix socket），仅允许 TCP localhost:17997，并阻止修改启动脚本、限制文件和 Clash 配置目录。已发现并修复旧规则允许复用 SSH ControlMaster/访问 Clash Unix 控制接口的问题。受限 Claude 内 SSH 因此不可用；不应将远端运行程序误认为仍受 Mac 防火墙保护。此方案不等同虚拟机隔离，不保证无法逃逸或账号不受限制。

使用说明与域名目录：`/network-guide.html`。新设备导入订阅只安装路由配置，不会自动部署 Edge、LuLu 或本机启动脚本。

### 当前 Mac：默认代理，远程与投屏直连

当前 Mac 为这份日常订阅单独安装了 `scripts/mac-routing.js`（`python3 scripts/install-mac-routing.py` 后在 Clash 点击「重新激活订阅」）。保持规则模式和 TUN；UU 远程、荣耀超级工作台 / 投屏及其后台进程优先直连，局域网、Tailscale 与手动直连例外保留，其余默认走「使用方案」。只移除本机的国内域名 / IP 自动直连匹配，不修改 NAS 分发配置。订阅刷新仍应用这个本地脚本；切换其他订阅不自动继承。原脚本备份在忽略目录 `data/usability-backup`。

Mac 项目修改由外部独立 Mutagen 会话同步，受限 Claude 内不能 SSH。已用注册的 `acmcoder-v3` 路径验证受限进程写入 → Mutagen 同步 → 外部 SSH 在 WSL 读取并断言内容一致，随后删除并同步清理临时文件。真实 Claude 生成仍需用户登录后验收；网络可达与文件同步不代表账号已可用。


### Claude 独立工作区与越界申请

打开「Claude 项目启动器」，先选择来源 Git 项目并给任务命名。副本位于来源项目的 `.claude-workspaces/<名称>`，有自己的 `.git` 与 `codex/claude-*` 分支，不共享主目录的 Git 元数据。仅复制已提交代码与提交历史，未提交改动、未跟踪文件和本地环境文件不会复制；已提交的内容仍会保留。准备工作区不需要 Claude 账号。已有同名副本只打开，不重置。

本项目已经准备 `.claude-workspaces/claude`。中央私有映射登记独立 WSL 目录 `/home/pygmalion/runs/004-route-policy-hub/claude`、Mutagen 会话 `route-policy-hub-claude` 和保留端口 `43874`。新建其他工作区不会自动复用这个运行目录，使用 WSL 前必须另行登记。

Read / Edit / Write / NotebookEdit / Glob / Grep 离开工作区时，Hook 只将路径、访问类型和工具名交给外部启动器，不复制文件内容。原生弹窗默认拒绝；批准只读文件或目录后，启动器重启并用 `--resume` 恢复同一会话，再重试原操作。读写文件需要授权父目录，以支持原子保存。授权只用于这次启动，不修改全局权限；下次重新启动默认无额外授权。整个主目录和包含启动器保护目录的范围不能被授权。

任意 Shell 程序内部的文件访问不能靠 Hook 全面分析，外层限制仍会阻止其越界。如果工具报权限错误，需改用明确路径的文件工具提出申请。该方案不是整机隔离，也不代表 Claude 账号已经登录可用。无账号验证：`python3 -B scripts/test-claude-permissions.py`；已用无敏感夹具真实验证原生弹窗、只读授权、会话恢复和网络限制保留。

### 浏览器、终端和恢复

Mac 系统时区已设为 Asia/Singapore（与上海同为 UTC+8）。专用 Edge 使用 en-SG / en，阻止网站定位，禁用非代理 WebRTC UDP；不删除缓存、日志、本地 ID、钥匙串或登录状态。语言和网络配置不保证服务风控结果。

本机 `.zshrc` 的 `Route Policy Hub terminal proxy` 标记区块让新交互终端的 HTTP(S) / ALL_PROXY 指向规则端口 7897，局域网和 Tailscale 地址例外。普通终端使用日常分流；专用启动器再覆盖为 17997。支持代理变量的工具在代理不可用时失败；不支持变量的工具依靠 TUN，Clash 完全退出后不保证普通程序系统级断网。没有将订阅转换为公开 API 中转，也未添加并发请求或自动换出口。

恢复材料在忽略的 `data/usability-backup`：原时区记录、原终端配置、专用 Edge 偏好和原订阅脚本。终端恢复可移除 `.zshrc` 的标记区块并新开窗口；Edge 退出后恢复对应 Preferences；Clash 恢复备份脚本并重新激活订阅；时区可在系统设置改回原记录。恢复时不覆盖随后新增的其他个人配置。
