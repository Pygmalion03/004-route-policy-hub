import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { stringify } from 'yaml';
import type { PolicyStore } from './policies';
import type { VpsNode } from './vps';
import { emptyHomeDraft, type HomeDraft } from './home-network-model';
export { emptyHomeDraft, simulateHomeRoute, type HomeDraft } from './home-network-model';
type GatewayConfig = {
  proxies: Record<string, unknown>[];
  rules: string[];
  dns: Record<string, unknown> & { listen: string; nameserver: string[] };
  [key: string]: unknown;
};
export type HomeBundle = { la: GatewayConfig; sg: GatewayConfig; files: Record<string, string> };
export class HomeDraftConflictError extends Error {
  constructor() { super('草稿已被其他页面修改，请重新读取后再保存'); }
}
const location = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'home-network.json');
let pending: Promise<unknown> = Promise.resolve();

function text(value: unknown, label: string, max = 200) {
  if (typeof value !== 'string' || value.length > max || value.split('').some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error(`${label}格式无效`);
  return value.trim();
}
const numberIp = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
function subnet(cidr: string) {
  const [ip, bits, extra] = cidr.split('/');
  const prefix = Number(bits), address = numberIp(ip);
  if (extra !== undefined || isIP(ip) !== 4 || !/^\d+$/.test(bits || '') || prefix < 16 || prefix > 30 ||
    !(ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip))) throw new Error('局域网须为私有 IPv4 网段，前缀范围 /16 至 /30');
  const size = 2 ** (32 - prefix);
  if (address % size) throw new Error('局域网 CIDR 须填写网段地址，例如 192.168.50.0/24');
  return { start: address, end: address + size - 1 };
}
export function validateHomeDraft(input: unknown): HomeDraft {
  if (!input || typeof input !== 'object') throw new Error('家庭网络草稿格式无效');
  const value = input as HomeDraft;
  if (value.version !== 1 || typeof value.sgDirectFallback !== 'boolean' || !Array.isArray(value.devices) || value.devices.length > 100) throw new Error('草稿版本、设备或保底设置无效');
  const lanCidr = text(value.lanCidr, '局域网 CIDR');
  const range = lanCidr ? subnet(lanCidr) : null;
  const ipv4 = (value: unknown, label: string) => {
    const ip = text(value, label, 15);
    if (ip && (isIP(ip) !== 4 || (range && (numberIp(ip) <= range.start || numberIp(ip) >= range.end)))) throw new Error(`${label}须为局域网内的 IPv4 主机地址`);
    return ip;
  };
  const nasIp = ipv4(value.nasIp, 'NAS 地址'), routerIp = ipv4(value.routerIp, '路由器地址');
  if (nasIp && nasIp === routerIp) throw new Error('NAS 和路由器地址不能相同');
  const lanInterface = text(value.lanInterface, 'NAS 网卡', 15);
  if (lanInterface && !/^[a-zA-Z0-9_.:-]+$/.test(lanInterface)) throw new Error('NAS 网卡名称无效');
  const addresses = new Set<string>(), macs = new Set<string>();
  const devices = value.devices.map(device => {
    if (!device || !['fixed-la', 'split-sg', 'router-direct'].includes(device.profile)) throw new Error('设备策略无效');
    const name = text(device.name, '设备名称', 60);
    if (!name) throw new Error('设备名称不能为空');
    const ip = ipv4(device.ip, `${name} 地址`), mac = text(device.mac, `${name} MAC`, 17).toLowerCase();
    if (ip && (addresses.has(ip) || ip === nasIp || ip === routerIp)) throw new Error('设备地址不能重复或占用 NAS / 路由器地址');
    if (mac && (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) || (parseInt(mac.slice(0, 2), 16) & 1) || mac === '00:00:00:00:00:00' || macs.has(mac))) throw new Error('设备 MAC 无效或重复');
    if (ip) addresses.add(ip);
    if (mac) macs.add(mac);
    return { name, ip, mac, profile: device.profile };
  });
  const tailscaleIp = text(value.claude?.tailscaleIp, 'LA Tailscale 地址', 15);
  if (tailscaleIp && (isIP(tailscaleIp) !== 4 || numberIp(tailscaleIp) < numberIp('100.64.0.0') || numberIp(tailscaleIp) > numberIp('100.127.255.255'))) throw new Error('Claude 远程地址须为 LA VPS 的 Tailscale IPv4 地址');
  const user = text(value.claude?.user, 'LA SSH 用户', 32), workspace = text(value.claude?.workspace, 'LA 工作目录', 500);
  if (user && !/^[a-z_][a-z0-9_-]*$/.test(user)) throw new Error('LA SSH 用户名无效');
  if (workspace && (!workspace.startsWith('/') || workspace === '/' || /(?:^|\/)\.\.(?:\/|$)/.test(workspace))) throw new Error('LA 工作目录须为远程绝对目录，不能是根目录或包含上级路径');
  const laVpsId = text(value.laVpsId, 'LA 节点标识', 80), sgVpsId = text(value.sgVpsId, 'SG 节点标识', 80);
  if (laVpsId && laVpsId === sgVpsId) throw new Error('LA 与 SG 须绑定不同的 VPS');
  const updatedAt = value.updatedAt;
  if (updatedAt !== null && (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)))) throw new Error('草稿版本时间无效');
  return { version: 1, updatedAt, lanCidr, nasIp, routerIp, lanInterface, laVpsId, sgVpsId, sgDirectFallback: value.sgDirectFallback, claude: { tailscaleIp, user, workspace }, devices };
}
export async function readHomeDraft(): Promise<HomeDraft> {
  try { return validateHomeDraft(JSON.parse(await readFile(/* turbopackIgnore: true */ location(), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyHomeDraft(); throw error; }
}
export function saveHomeDraft(input: unknown): Promise<HomeDraft> {
  const operation = pending.catch(() => {}).then(async () => {
    const draft = validateHomeDraft(input), current = await readHomeDraft();
    if (draft.updatedAt !== current.updatedAt) throw new HomeDraftConflictError();
    const next = { ...draft, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt || '') + 1 || 0)).toISOString() };
    const file = location(), temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
    return next;
  });
  pending = operation;
  return operation;
}
export function homeDraftIssues(draft: HomeDraft, nodes: VpsNode[]): string[] {
  const issues: string[] = [];
  for (const [key, label] of Object.entries({ lanCidr: '局域网 CIDR', nasIp: 'NAS 地址', routerIp: '中兴路由器地址', lanInterface: 'NAS 网卡' })) {
    if (!draft[key as keyof HomeDraft]) issues.push(`请填写${label}`);
  }
  for (const [id, label] of [[draft.laVpsId, 'LA'], [draft.sgVpsId, 'SG']]) {
    const node = nodes.find(node => node.id === id);
    if (!node) issues.push(`请绑定已保存的 ${label} VPS`);
    else if (isIP(node.node.server) !== 4 || !['vless', 'hysteria2'].includes(node.node.type) || node.node['dialer-proxy']) issues.push(`${label} 需要使用数值 IPv4 的独立 VLESS / Hysteria2 节点`);
  }
  for (const device of draft.devices.filter(device => device.profile !== 'router-direct')) {
    if (!device.ip || !device.mac) issues.push(`请填写 ${device.name} 的固定 IPv4 和稳定 MAC`);
  }
  if (!draft.devices.some(device => device.profile === 'fixed-la')) issues.push('请添加 LA 固定出口设备');
  if (!draft.devices.some(device => device.profile === 'split-sg')) issues.push('请添加 SG 分流设备');
  if (!draft.claude.tailscaleIp || !draft.claude.user || !draft.claude.workspace) issues.push('请填写 Claude 在 LA 的 Tailscale 地址、SSH 用户和工作目录');
  return issues;
}
export function generateHomeNetwork(input: HomeDraft, nodes: VpsNode[], policy: PolicyStore): HomeBundle {
  const draft = validateHomeDraft(input), issues = homeDraftIssues(draft, nodes);
  if (issues.length) throw new Error(issues.join('；'));
  const localCidrs = [draft.lanCidr, '100.64.0.0/10', '169.254.0.0/16', '224.0.0.0/4', '255.255.255.255/32'];
  const makeConfig = (role: 'LA' | 'SG', id: string, port: number, dnsPort: number): GatewayConfig => ({
    'tproxy-port': port, 'allow-lan': true, 'bind-address': '*', mode: 'rule', ipv6: false,
    'log-level': 'warning', 'find-process-mode': 'off',
    profile: { 'store-selected': false, 'store-fake-ip': false },
    dns: {
      enable: true, listen: `0.0.0.0:${dnsPort}`, ipv6: false, 'enhanced-mode': 'redir-host',
      'default-nameserver': ['1.1.1.1'],
      nameserver: [`https://1.1.1.1/dns-query#${role}`],
    },
    proxies: [{ ...nodes.find(node => node.id === id)!.node, name: role, 'ip-version': 'ipv4' }],
    rules: [...localCidrs.map(cidr => `IP-CIDR,${cidr},DIRECT,no-resolve`), `MATCH,${role}`],
  });
  const la = makeConfig('LA', draft.laVpsId, 7893, 1053), sg = makeConfig('SG', draft.sgVpsId, 7894, 1054);
  const networkMatchers = (action: string) => policy.policies.filter(p => p.enabled && p.action === action).flatMap(p => p.matchers.filter(m => m.type !== 'PROCESS-NAME').map(m => `${m.type},${m.value}${m.noResolve ? ',no-resolve' : ''}`));
  sg['rule-providers'] = {
    'hub-direct': { type: 'inline', behavior: 'classical', payload: networkMatchers('DIRECT') },
    'hub-proxy': { type: 'inline', behavior: 'classical', payload: networkMatchers('PROXY') },
    ...Object.fromEntries([['china-domains', 'domain', 'geosite'], ['china-ips', 'ipcidr', 'geoip']].map(([name, behavior, source]) => [name, {
      type: 'http', behavior, format: 'mrs', url: `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/${source}/cn.mrs`,
      path: `./rules/${name}.mrs`, interval: 86400, proxy: 'SG',
    }])),
  };
  sg.rules.splice(-1, 0, 'RULE-SET,hub-direct,DIRECT', 'RULE-SET,hub-proxy,SG', 'RULE-SET,china-domains,DIRECT', 'RULE-SET,china-ips,DIRECT');
  // Resolver traffic follows the same SG group, including its explicit optional broadband fallback.
  sg.dns['nameserver-policy'] = {
    'rule-set:hub-direct': ['https://223.5.5.5/dns-query#DIRECT'],
    'rule-set:hub-proxy': ['https://1.1.1.1/dns-query#SG'],
    'rule-set:china-domains': ['https://223.5.5.5/dns-query#DIRECT'],
  };
  if (draft.sgDirectFallback) {
    sg.proxies[0].name = 'SG-node';
    sg['proxy-groups'] = [{ name: 'SG', type: 'fallback', proxies: ['SG-node', 'DIRECT'], url: 'https://www.gstatic.com/generate_204', interval: 30, lazy: false }];
  }
  const laDevices = draft.devices.filter(device => device.profile === 'fixed-la');
  const sgDevices = draft.devices.filter(device => device.profile === 'split-sg');
  const managed = [...laDevices, ...sgDevices];
  const set = (name: string, type: string, elements: string[], flags = '') => `  set ${name} { type ${type}; ${flags}${elements.length ? `elements = { ${elements.join(', ')} };` : ''} }\n`;
  const firewall = `# DRAFT ONLY. Dedicated table; never flushes the NAS ruleset.
# Load together with policy routing, after NAS firewall compatibility review.
table inet rph_home {
${set('la4', 'ipv4_addr', laDevices.map(d => d.ip))}${set('sg4', 'ipv4_addr', sgDevices.map(d => d.ip))}${set('managed4', 'ipv4_addr', managed.map(d => d.ip))}${set('managed_macs', 'ether_addr', managed.map(d => d.mac))}${set('bindings4', 'ether_addr . ipv4_addr', managed.map(d => `${d.mac} . ${d.ip}`))}${set('local4', 'ipv4_addr', localCidrs, 'flags interval; auto-merge; ')}
  chain intercept {
    type filter hook prerouting priority mangle; policy accept;
    iifname != "${draft.lanInterface}" return
    ether saddr @managed_macs meta nfproto ipv4 ether saddr . ip saddr != @bindings4 drop
    ether saddr @managed_macs meta nfproto ipv6 ip6 daddr != { fc00::/7, fe80::/10, ff00::/8 } drop
    ip saddr @managed4 meta l4proto { tcp, udp } th dport 53 return
    ip daddr @local4 return
    ip saddr @la4 meta l4proto { tcp, udp } meta mark set 0x4800 tproxy ip to :7893 accept
    ip saddr @sg4 meta l4proto { tcp, udp } meta mark set 0x4800 tproxy ip to :7894 accept
    ip saddr @managed4 drop
  }
  chain dns {
    type nat hook prerouting priority dstnat; policy accept;
    iifname "${draft.lanInterface}" ip saddr @la4 meta l4proto { tcp, udp } th dport 53 redirect to :1053
    iifname "${draft.lanInterface}" ip saddr @sg4 meta l4proto { tcp, udp } th dport 53 redirect to :1054
  }
  chain protect_listeners {
    type filter hook input priority -10; policy accept;
    meta mark 0x4800 return
    iifname "${draft.lanInterface}" ip saddr @la4 meta l4proto { tcp, udp } th dport 1053 return
    iifname "${draft.lanInterface}" ip saddr @sg4 meta l4proto { tcp, udp } th dport 1054 return
    meta l4proto { tcp, udp } th dport { 1053, 1054, 7893, 7894 } drop
  }
  chain prevent_bypass {
    type filter hook forward priority -10; policy accept;
    iifname "${draft.lanInterface}" ip saddr @managed4 ip daddr != @local4 drop
    iifname "${draft.lanInterface}" ether saddr @managed_macs meta nfproto ipv6 ip6 daddr != { fc00::/7, fe80::/10, ff00::/8 } drop
  }
}
`;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const remote = `cd -- ${quote(draft.claude.workspace)} && exec env ${['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'ANTHROPIC_BASE_URL'].map(key => `-u ${key}`).join(' ')} claude`;
  const launcher = `#!/bin/sh
# Runs Claude on LA through Tailscale. Does not install or copy credentials.
set -eu
exec ssh -F /dev/null -o ProxyCommand=none -o ProxyJump=none -o ClearAllForwardings=yes -o ForwardAgent=no -o ExitOnForwardFailure=yes -tt -- ${quote(`${draft.claude.user}@${draft.claude.tailscaleIp}`)} ${quote(remote)}
`;
  const devices = draft.devices.map(d => ({
    ...d, gateway: d.profile === 'router-direct' ? draft.routerIp : draft.nasIp,
    dns: d.profile === 'router-direct' ? draft.routerIp : draft.nasIp,
    ipv6: d.profile === 'router-direct' ? 'unchanged' : 'disable-public-ipv6-before-activation',
  }));
  const files: Record<string, string> = {
    'mihomo-la.yaml': stringify(la), 'mihomo-sg.yaml': stringify(sg), 'firewall.nft': firewall,
    'devices.json': `${JSON.stringify({ status: 'draft-not-applied', devices }, null, 2)}\n`,
    'claude-la.command': launcher,
    'routing.commands.txt': `# DRAFT: manual Linux commands only; nothing executes when exporting.
# Reserve mark 0x4800/mask 0xffff, priority/table 10480; stop if already in use.
# Check first: ip rule show; ip route show table 10480; nft list ruleset
ip route add local 0.0.0.0/0 dev lo table 10480
ip rule add priority 10480 fwmark 0x4800/0xffff lookup 10480
# Validate before loading: nft -c -f firewall.nft
# First installation only, with dedicated table absent: nft -f firewall.nft
# Keep the kill switch installed if a Mihomo process stops.
# Never remove the firewall while LA devices still use this NAS as gateway.
`,
    '99-rph-home.conf': `# DRAFT: review NAS / Tailscale settings before installing.
net.ipv4.ip_forward=1
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
net/ipv4/conf/${draft.lanInterface}/send_redirects=0
net.ipv4.conf.all.rp_filter=0
net/ipv4/conf/${draft.lanInterface}/rp_filter=0
`,
    'compose.gateway.yaml': `# DRAFT. No service starts without the explicit manual-activation profile.
services:
  la:
    image: \${MIHOMO_IMAGE:?Set an explicitly reviewed pinned Mihomo image}
    profiles: [manual-activation]
    network_mode: host
    cap_drop: [ALL]
    cap_add: [NET_ADMIN, NET_BIND_SERVICE]
    read_only: true
    security_opt: ["no-new-privileges:true"]
    command: ["-d", "/runtime", "-f", "/etc/mihomo/config.yaml"]
    volumes: ["./mihomo-la.yaml:/etc/mihomo/config.yaml:ro", "./runtime/la:/runtime"]
  sg:
    image: \${MIHOMO_IMAGE:?Set an explicitly reviewed pinned Mihomo image}
    profiles: [manual-activation]
    network_mode: host
    cap_drop: [ALL]
    cap_add: [NET_ADMIN, NET_BIND_SERVICE]
    read_only: true
    security_opt: ["no-new-privileges:true"]
    command: ["-d", "/runtime", "-f", "/etc/mihomo/config.yaml"]
    volumes: ["./mihomo-sg.yaml:/etc/mihomo/config.yaml:ro", "./runtime/sg:/runtime"]
`,
    'READ-ME-FIRST.txt': `家庭网络配置草稿：未安装、未应用、未完成真实网络验收。

LA：公网 TCP/UDP 与 DNS 固定 LA，失败停止；不读直连网站例外，不切 SG。
SG：网站例外、国内规则直连，其余经 SG。SG 故障直连保底：${draft.sgDirectFallback ? '已选择（健康检查约 30 秒，并非即时切换）' : '未选择'}。
NAS 故障：两组公网都停止；Windows / 安卓需手动将网关和 DNS 改为 ${draft.routerIp}；Mac / iPhone 不改回中兴。
其他设备始终使用中兴网关，不进入 NAS。公网 ICMP 等非 TCP/UDP 协议被阻止；同网段局域网连接保留。
Claude：使用 claude-la.command，经 Tailscale SSH 在 LA 工作目录启动已安装的 Claude。远程清除常用代理变量，但服务器自身路由、防火墙及 Claude 设置仍须验收。

上线前必须逐项确认：
1. 用户另行授权部署；阅读项目 NAS 基础设施文档。核实 NAS 物理网卡、Linux TPROXY/nftables、两个独立进程端口和既有 Docker/Tailscale 防火墙兼容性。
2. 在路由器固定 IP/MAC；使用稳定 Wi-Fi MAC。NAS 自身网关保持中兴。仅选定设备的网关/DNS 指向 NAS，不全局改 DHCP。
3. 关闭受管设备的公网 IPv6，或在中兴按设备/VLAN 阻断绕过 NAS 的 IPv6 与直连 WAN。NAS 规则无法阻断同网段中兴发出的 RA，也无法拦截流量绕行。
4. 关闭受管设备现有 VPN、代理、Private Relay、备用 Wi-Fi、蜂窝/Wi-Fi 助理及自动切换网关。否则设备可能另走出口。
5. 先保存 NAS 原 sysctl、路由和防火墙。确认 mark/table 未占用、关闭 ICMP redirects，允许已有 INPUT 链接收透明代理标记和两个 DNS 入口。不要 flush ruleset。
6. 使用审核过的固定版本 MIHOMO_IMAGE。分别 mihomo -t 校验；执行 nft -c；先安装防绕行规则与策略路由，再启动两个实例，最后改变设备网关。此包不自动执行任何步骤。
7. 实测 LA/SG 地区与公网出口、DNS、TCP、UDP/QUIC、投屏、Tailscale；依次断开 LA、SG、各代理进程、NAS，抓包确认 IPv4/IPv6/DNS 没有绕行。MAC/IP 更改后重测。
8. 回退前先隔离 LA 设备公网或关闭其网络；只将 SG 设备手动恢复中兴网关/DNS。然后按原值恢复 NAS 的规则与系统设置，不全局清空防火墙。

SG 国内规则在首次启动时下载；未下载成功不能宣称国内分流可用。网站例外以导出时快照保存，后续修改后需重新导出并人工更新。
本包包含节点凭据，保存在私有目录，不提交 Git、不分享、不放在公开 Web 目录。地区来自所选节点人工绑定，程序没有测定节点的物理位置。
`,
  };
  return { la, sg, files };
}
export function homeNetworkPreview(bundle: HomeBundle) {
  // Allowlist the visible routing information; never recursively echo arbitrary node fields.
  return {
    status: 'draft-not-applied',
    la: { rules: bundle.la.rules, dns: bundle.la.dns, tproxyPort: bundle.la['tproxy-port'] },
    sg: { rules: bundle.sg.rules, dns: bundle.sg.dns, tproxyPort: bundle.sg['tproxy-port'], fallback: bundle.sg['proxy-groups'] || null },
    files: Object.keys(bundle.files),
  };
}
