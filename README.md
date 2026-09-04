# 004-route-policy-hub

中文产品名：**分流清单**。

这是一个运行在 NAS 上的私人规则管理页面。只维护“某个服务应该直连还是代理”，自动输出 Mihomo / Clash 可定时获取的规则集。

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
