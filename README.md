# 004-route-policy-hub

中文产品名：**分流清单**。

这是一个运行在 NAS 上的私人规则管理页面。只维护“某个服务应该直连还是代理”，自动输出 Mihomo / Clash 可定时获取的规则集。

## 极空间 Q4 部署

1. 将本目录上传到极空间，例如放到 `Docker/route-list`。
2. 如需管理密码，将 `.env.example` 复制为 `.env`，并修改 `ADMIN_PASSWORD`。
3. 在该目录执行：

   ```bash
   docker compose up -d --build
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
