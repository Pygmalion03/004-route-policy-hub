# Hugging Face 国内大模型下载：hf-mirror.net + IDM 实战

> 目标：在 Windows 上下载 Hugging Face 的大体积模型文件时，使用 `hf-mirror.net` 获取可分段下载的直链，并交给 Internet Download Manager（IDM）进行多连接下载。
>
> 本文记录一次 MiniMax-H3 模型下载的实际排障与可复用经验。

## 参考与致谢

本方法的重要线索来自 B 站视频：

- 视频：**《Hugging Face不用科学上网，国内极速下载！》**
- BV 号：**BV1mWtH65E29**
- 作者：**转基因大魔王**
- 链接：https://www.bilibili.com/video/BV1mWtH65E29
- 视频简介给出的镜像：`hf-mirror.net`

感谢原作者分享思路。下面除“参考视频”之外，还包含本次实际测试得到的补充结论。

## 一句话结论

Hugging Face 文件地址不要把 `/blob/main/` 原样换域名后交给 IDM。

应使用：

```text
https://hf-mirror.net/<owner>/<repo>/resolve/main/<path/to/file>
```

例如：

```text
https://hf-mirror.net/AX1Y2JP/MiniMax-H3-W4A8-ConvRot/resolve/main/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors
```

而下面这种 `blob` 页面地址在本次实测中返回 404：

```text
https://hf-mirror.net/AX1Y2JP/MiniMax-H3-W4A8-ConvRot/blob/main/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors
```

## 为什么用 `resolve` 而不是 `blob`

Hugging Face 的：

```text
/blob/main/...
```

通常代表网页浏览路由；真正的文件下载入口是：

```text
/resolve/main/...
```

本次对 `hf-mirror.net` 的实际请求结果：

- `/blob/main/...`：HTTP 404
- `/resolve/main/...`：HTTP 200
- 返回 `Content-Type: application/octet-stream`
- 支持 `Accept-Ranges: bytes`
- 带 `Content-Disposition: attachment`

支持 Range 是 IDM 多连接分段下载能够发挥作用的关键之一。

## IDM 为什么会更快

本次排障中，单连接下载速度明显较低；模拟 16/32 路 Range 并发后，总吞吐明显提高。

IDM 的优势正是自动把大文件切分为多个区间，同时建立多个连接进行下载，并支持断点续传。

因此对于 10GB、20GB 乃至更大的 `.safetensors` / `.gguf` 文件，可以优先尝试：

1. 找到 Hugging Face 文件；
2. 把域名换成 `hf-mirror.net`；
3. 把 `/blob/main/` 改为 `/resolve/main/`；
4. 将最终 URL 加入 IDM。

## 通用 URL 转换规则

原始 Hugging Face 页面：

```text
https://huggingface.co/OWNER/REPO/blob/main/PATH/FILE
```

转换为：

```text
https://hf-mirror.net/OWNER/REPO/resolve/main/PATH/FILE
```

也可以在末尾加：

```text
?download=true
```

完整形式：

```text
https://hf-mirror.net/OWNER/REPO/resolve/main/PATH/FILE?download=true
```

## 下载前先验证

Windows PowerShell / CMD：

```powershell
curl.exe -I -L --max-time 20 "https://hf-mirror.net/OWNER/REPO/resolve/main/PATH/FILE"
```

理想结果应至少看到：

```text
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: ...
Accept-Ranges: bytes
```

如果 `Content-Length` 与 Hugging Face 页面显示的模型大小一致，基本可以确认拿到的是模型文件本体。

## IDM 命令行加入下载

IDM 默认安装目录通常为：

```text
C:\Program Files (x86)\Internet Download Manager\IDMan.exe
```

直接开始下载：

```powershell
& "C:\Program Files (x86)\Internet Download Manager\IDMan.exe" `
  /d "DIRECT_URL" `
  /p "E:\Models\downloads" `
  /f "MODEL_FILENAME" `
  /n
```

加入队列但不立即抢带宽：

```powershell
& "C:\Program Files (x86)\Internet Download Manager\IDMan.exe" `
  /d "DIRECT_URL" `
  /p "E:\Models\downloads" `
  /f "MODEL_FILENAME" `
  /n /a
```

其中 `/a` 适合批量加入很多模型分片，等当前任务完成后再统一启动。

## Clash / VPN 注意事项

如果机器运行 Clash Verge：

```text
DOMAIN-SUFFIX,hf-mirror.net,DIRECT
```

可以让 `hf-mirror.net` 不走代理节点。

但要注意：

> **Clash 的 DIRECT 不等于完全绕过 Clash/TUN。**

如果开启了 TUN，连接仍可能经过 mihomo/TUN 网络栈，只是出口不经过代理节点。

本次实际排障中，通过 Clash 日志确认：

```text
hf-mirror.net:443 ... using DIRECT
```

因此可以确认没有消耗代理节点流量；如果还希望排除 TUN 本身对吞吐的影响，可以在大文件下载期间关闭 Clash/TUN，再进行一次对比测试。

## IDM 安装目录与缓存目录

IDM 程序本身建议使用默认安装目录，不需要为了模型下载装到大容量盘。

更值得修改的是：

- 最终下载目录：放到容量大的数据盘；
- IDM 临时目录：同样放到容量大的数据盘。

例如：

```text
最终模型：E:\Models\MiniMax-H3\downloads
IDM 临时：E:\IDM_Temp
```

这样多线程分段临时文件不会大量占用系统盘。

## MiniMax-H3 示例

### FL2VA W4A8

```text
https://hf-mirror.net/AX1Y2JP/MiniMax-H3-W4A8-ConvRot/resolve/main/minimax_h3_fl2va_pruned_w4a8_mixed.safetensors?download=true
```

### Ref2VA W4A8

```text
https://hf-mirror.net/AX1Y2JP/MiniMax-H3-W4A8-ConvRot/resolve/main/minimax_h3_ref2va_pruned_w4a8_mixed.safetensors?download=true
```

两者都是约 11.68 GiB 的 pruned W4A8 ConvRot 单文件模型。

## 多文件仓库怎么办

有些 Hugging Face 模型不是一个大文件，而是：

```text
model/
├── config.json
├── model-00001-of-00005.safetensors
├── model-00002-of-00005.safetensors
├── ...
└── model.safetensors.index.json
```

这时可以：

1. 通过 Hugging Face / mirror API 列出仓库文件；
2. 对所有大权重分片生成 `/resolve/main/` 直链；
3. 用 IDM `/a` 批量加入队列；
4. 小型 config/index 文件用普通 HTTP 请求补齐；
5. 保持原目录结构。

这样可以把“整仓库下载”转换为“IDM 批量多线程下载”，尤其适合数十 GB 的 Diffusers / 分片权重仓库。

## 排障清单

遇到“速度慢 / 下到 HTML / IDM 不接管”时依次检查：

1. URL 是否仍然是 `/blob/main/`；
2. 是否已改为 `/resolve/main/`；
3. HEAD 是否返回 `application/octet-stream`；
4. 是否有正确的 `Content-Length`；
5. 是否支持 `Accept-Ranges: bytes`；
6. IDM 是否启用了多个连接；
7. IDM 自身是否误配 HTTP/SOCKS Proxy；
8. Clash 是否对 `hf-mirror.net` 命中 DIRECT；
9. 如果 DIRECT 仍慢，关闭 TUN/Clash 后再对比；
10. 多文件模型是否保留了原目录与 index/config 文件。

## 免责声明

镜像站、Hugging Face 仓库结构、CDN 路由和网盘/模型服务策略都有可能变化。大批量下载前建议先用 HEAD 或小 Range 请求确认当前行为，并遵守模型许可证、镜像站和服务提供商的使用规则。
