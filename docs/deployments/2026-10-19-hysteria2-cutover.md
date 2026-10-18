# Mac 日常线路切换至 Hysteria2

用户授权日常线路改用 Hysteria2，保留现有 VLESS + REALITY + Vision 为备用，Claude 固定出口及 UU、荣耀直连例外保持原样。

## 已部署

- Legend VPS 新增官方 Hysteria `app/v2.13.0`，下载资产经官方发布 SHA256 校验。独立 `route-policy-hysteria2.service` 开机启动，以专用用户运行，仅授予绑定低端口能力，监听 UDP 443。
- 原 `route-policy-xray.service` 和 VLESS TCP 443 保留。新服务不提供无认证入口，拒绝转发至私有 / 本地地址。
- Hysteria2 使用证书 SHA256 固定校验，不关闭证书验证。证书私钥仅在 VPS；认证与客户端材料由 VPS、本机忽略的 `data/legend-hysteria2/`、NAS `DATA_DIR` 和 Clash 私有配置保管，未纳入 Git。
- 网站解析器支持 `hysteria2://` / `hy2://` 链接，保留原 VLESS 解析；拒绝关闭证书校验以及当前未支持的混淆 / ECH 参数。
- NAS 正式镜像更新至 `ghcr.io/pygmalion03/004-route-policy-hub:sha-aee3ba7`。仅改镜像标签，认证、环境变量、映射目录均保留。旧 `sha-e227adb` 镜像保留供回滚。
- 原日常订阅已发布并刷新，Clash 保持规则模式与 TUN。使用方案为「只用 VPS」，VPS 节点选择「自建 VPS｜Legend SG · Hysteria2」，选择由现有配置持久保存。
- 「自建 VPS｜Legend SG」仍为 VLESS 手动备用。未新增自动故障切换，也未实施 NAS 旁路由。

## 验收

- `pnpm lint`、`pnpm build`、部署脚本语法检查和链接解析检查通过。
- 本机构建后的服务：两条规则端点 200，未认证连接写入 401，认证写入 200；新增 Hysteria2 后 Claude 独立副本逐字段相同，生成订阅含正确证书指纹。
- 正式 Hysteria2 独立客户端 12 / 12 请求成功，出口符合原 VPS；错误认证失败，无直连回退。
- 正式 NAS 两条规则端点均 200，未认证连接写入 401；现有管理会话实际发布新节点成功，原 VLESS 条目保留。
- 刷新 Mac 订阅前后，Claude 专用入口及其节点内容哈希相同；所有路由规则及顺序哈希相同。
- 切换后，通过普通端口的实际连接链为 Hysteria2 → VPS 节点 → 只用 VPS → 使用方案；专用 17997 仍只走原 Claude VLESS 节点。
- 日常线路 8 / 8 请求成功。Claude 受限命令行、固定 IP、LuLu / Edge 规则检查通过；Anthropic API 返回预期 401，仅证明连通性。
- 当前 UURemote、UURemoteServer、HnOfficeCenter 的真实连接均为 DIRECT。

原始验收记录位于忽略的 `data/hysteria2-cutover-2026-10-19/`；截图位于 `outputs/hysteria2-subscription-live.png` 与 `outputs/hysteria2-clash-live.png`。未登录 Claude 进行真实生成。

## 备份与恢复

- NAS 的 `DATA_DIR/connections.before-hysteria2-2026-10-19.json` 已在修改前备份，未读取或打印凭据。
- Mac 原活跃订阅、运行配置、配置清单备份在 `data/hysteria2-cutover-2026-10-19/before-*`，按秘密材料保管。
- 日常快速恢复：Clash → 代理 → VPS 节点 → 选择「自建 VPS｜Legend SG」。Claude 独立配置不需要修改。
- 网站镜像需要回滚时，将原 Compose 镜像标签恢复为 `sha-e227adb`；保留原持久数据。只为恢复日常线路时无需回滚网站或删除 Hysteria2 条目。
- 重新安装 Hysteria2 可使用现有密码库映射运行 `scripts/vps-hysteria2.py`。脚本复用已保存的认证与服务器证书，拒绝覆盖非本项目配置或旋转不匹配的既有认证。
