# 004-route-policy-hub

中文产品名：**分流清单**。

这是一个运行在 NAS 上的私人规则管理页面。管理“某个服务应该直连还是代理”，并集中维护机场订阅与 Webshare 固定出口，自动输出 Mihomo / Clash 可更新的规则集和完整配置。

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

进入页面后点击“Clash 接入方式”，填写订阅中的代理策略组名称。页面会根据当前访问地址生成两段配置：

- `rule-providers` 放进当前订阅的“扩展配置（Merge）”；
- 两条 `RULE-SET` 放进“规则配置（Rules）”的 `prepend`。

Clash 默认每小时获取：

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
Clash / Mihomo 订阅，成功后保存节点快照，以完整配置直接提供给客户端，避免首次启动依赖机场订阅下载通道。Clash 每小时更新配置时，服务端刷新节点；下载失败保留上次成功的节点，并在管理页面提示。

首次配置可以从本机已经验证的日常配置导入（脚本依赖 macOS 自带 Ruby）：

```bash
python3 scripts/import-clash.py /absolute/path/to/daily.yaml --data-dir /absolute/path/to/private-data
```

配置及节点凭据保存于 `DATA_DIR/connections.json`，权限为 `0600`。备份时同时保护
这个文件。订阅下载地址由独立的随机令牌保护，不能分享、公开存储或记录完整请求
URL。连接配置接口在未设置 `ADMIN_PASSWORD` 时拒绝访问；不要把管理密码用于
Clash 订阅令牌。

在页面复制专用配置地址，导入官方 Clash Verge Rev。日常仍在 Clash 中选前置机场
及其节点；最终出口固定为 Webshare。机场 / Webshare 参数修改后更新这份配置，
直连 / 代理规则通过既有只读 Mihomo rule providers 每 5 分钟更新。固定 AI 代理
监听 `127.0.0.1:17897`，不会随国内直连名单切换出口。不存在 Webshare 失败后的
机场或 DIRECT 自动回退。

网站运行于 NAS，维护规则与分发配置，不承担旁路由转发。设置 `PUBLIC_BASE_URL`
为客户端实际访问的 HTTPS 域名，避免反向代理下产生内部地址。管理入口保持 LAN /
Tailscale；若启用 Cloudflare Tunnel 公网入口，先设置认证，订阅和只读规则路径
必须允许 Clash 无交互获取，管理 API 则始终要求管理密码。请勿为整个站点开启
缓存，也不要为订阅请求启用包含完整 URL 的访问日志。
