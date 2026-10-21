import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { readPolicyStore } from './policies';
import { parseVpsLink, type VpsNode } from './vps';

type Node = Record<string, unknown> & { name: string };
export type Endpoint = { server: string; port: number; type: 'http' | 'socks5'; username: string; password: string };
type Airport = { id: string; name: string; url: string; nodes: Node[]; refreshedAt?: string; refreshError?: string };
export type ConnectionStore = {
  version: 1; updatedAt: string; token: string;
  webshare: { direct: Endpoint; backbone: Endpoint };
  airports: Airport[];
  vpsNodes?: VpsNode[];
  webshareMethod?: 'direct' | 'backbone';
  claude?: { mode?: 'vps' | 'webshare'; vpsId?: string; expectedIp: string; pinnedAt: string; frontName: string; endpoint?: Endpoint; front: Node };
  defaults: Record<string, unknown>;
};
const location = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'connections.json');
let pending: Promise<unknown> = Promise.resolve();

export function connectionAuthorized(request: Request) {
  const expected = process.env.ADMIN_PASSWORD;
  const supplied = request.headers.get('x-admin-password') || '';
  return Boolean(expected) && equalSecret(supplied, expected!);
}
export function equalSecret(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function readConnections(): Promise<ConnectionStore | null> {
  try { return JSON.parse(await readFile(/* turbopackIgnore: true */ location(), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export function publicConnections(store: ConnectionStore | null) {
  if (!store) return { configured: false };
  const pinned = store.claude;
  const source = pinned && store.vpsNodes?.find(v => pinned.vpsId ? v.id === pinned.vpsId : v.name === pinned.frontName);
  const withoutName = (node: Node) => { const { name: _name, ...connection } = node; return connection; };
  const sourceChanged = Boolean(pinned && (!source ||
    !isDeepStrictEqual(withoutName(source.node), withoutName(pinned.front)) ||
    (pinned.mode !== 'vps' && !isDeepStrictEqual(store.webshare[store.webshareMethod || 'direct'], pinned.endpoint))));
  return {
    configured: true, updatedAt: store.updatedAt,
    webshareMethod: store.webshareMethod || 'direct',
    claude: pinned ? { mode: pinned.mode || 'webshare', vpsId: source?.id, expectedIp: pinned.expectedIp, pinnedAt: pinned.pinnedAt, frontName: pinned.frontName, sourceChanged, port: 17997 } : null,
    webshare: Object.fromEntries(Object.entries(store.webshare).map(([key, endpoint]) => [key, { ...endpoint, password: '', hasPassword: Boolean(endpoint.password) }])),
    airports: store.airports.map(({ id, name, nodes, refreshedAt, refreshError }) => ({ id, name, nodeCount: nodes.length, url: '', hasUrl: true, refreshedAt, refreshError })),
    vpsNodes: (store.vpsNodes || []).map(({ id, name, node }) => ({ id, name, server: node.server, port: node.port, type: node.type, hasConfig: true, shareUrl: '' })),
  };
}
function text(value: unknown, label: string, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (/[\r\n]/.test(value) || value.includes(String.fromCharCode(0)))) throw new Error(`${label}无效`);
  return value.trim();
}
async function downloadAirport(url: string, timeoutMs = 20000) {
  let result: Response;
  try { result = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'clash-verge/2.5.8' }, cache: 'no-store' }); }
  catch { throw new Error('机场订阅下载失败，请确认 NAS 能访问该订阅地址'); }
  if (!result.ok) throw new Error(`机场订阅返回 HTTP ${result.status}`);
  const body = await result.text();
  if (body.length > 4 * 1024 * 1024) throw new Error('机场订阅过大');
  let content;
  try { content = parse(body); } catch { throw new Error('机场订阅不是有效的 Clash YAML'); }
  const nodes = content?.proxies?.filter((node: Node) => node && typeof node.name === 'string' && typeof node.server === 'string' && typeof node.type === 'string' && !/剩余流量|套餐到期|官网|TG群|有超时/.test(node.name));
  if (!Array.isArray(nodes) || !nodes.length) throw new Error('订阅中没有节点，请使用 Clash / Mihomo 格式的订阅地址');
  // Subscription routing references belong to its original configuration.
  return nodes.map((node: Node) => {
    const clean = { ...node };
    delete clean['dialer-proxy'];
    return clean;
  }) as Node[];
}
export async function saveConnections(input: unknown) {
  const operation = pending.catch(() => {}).then(async () => {
    const current = await readConnections();
    if (!current) throw new Error('请先导入本机已验证的配置');
    const value = input as { updatedAt: string; pinClaude?: { vpsId: string; expectedIp: string; mode?: 'vps' | 'webshare' }; webshareMethod?: 'direct' | 'backbone'; webshare: Record<string, Endpoint>; airports: { id: string; name: string; url: string }[]; vpsNodes?: { id: string; name: string; shareUrl: string }[] };
    if (value.updatedAt !== current.updatedAt) throw new Error('配置已被其他页面修改，请重新读取后再保存');
    const vpsInput = value.vpsNodes ?? current.vpsNodes?.map(v => ({ id: v.id, name: v.name, shareUrl: '' })) ?? [];
    if (!Array.isArray(vpsInput) || vpsInput.length > 10) throw new Error('自建 VPS 数量不能超过 10 个');
    const vpsIds = new Set<string>(), vpsNames = new Set<string>();
    const vpsNodes: VpsNode[] = vpsInput.map(item => {
      const id = text(item.id, 'VPS 标识', 80), name = text(item.name, 'VPS 名称', 40);
      if (!/^[a-z0-9-]+$/.test(id) || vpsIds.has(id) || vpsNames.has(name) || /[,|]/.test(name)) throw new Error('VPS 名称或标识重复、无效');
      vpsIds.add(id); vpsNames.add(name);
      const previous = current.vpsNodes?.find(v => v.id === id);
      const node = item.shareUrl?.trim() ? parseVpsLink(item.shareUrl.trim(), name) : previous?.node;
      if (!node) throw new Error('新 VPS 需要填写代理节点链接，SSH 地址不能直接作为代理使用');
      return { id, name, node: { ...node, name } };
    });
    if (!Array.isArray(value.airports) || value.airports.length > 10 || (!value.airports.length && !vpsNodes.length)) throw new Error('请至少保留一个机场或自建 VPS');
    const names = new Set<string>();
    const ids = new Set<string>();
    const airports: Airport[] = [];
    for (const item of value.airports) {
      const id = text(item.id, '机场标识', 80);
      if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error('机场标识无效或重复');
      ids.add(id);
      const name = text(item.name, '机场名称', 40);
      if (names.has(name) || ['固定出口', '前置机场', '前置线路', '出口模式', 'VPS 直出', '机场直出', '自建 VPS', '订阅更新通道'].includes(name) || /[,|]/.test(name)) throw new Error('机场名称重复或包含保留字符');
      names.add(name);
      const previous = current.airports.find((airport) => airport.id === id);
      const url = item.url?.trim() || previous?.url;
      if (!url || !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('请填写 HTTP(S) 机场订阅地址');
      const nodes = previous?.url === url ? previous.nodes : await downloadAirport(url);
      airports.push({ id, name, url, nodes, refreshedAt: previous?.url === url ? previous.refreshedAt : new Date().toISOString(), refreshError: previous?.url === url ? previous.refreshError : undefined });
    }
    const webshare = {} as ConnectionStore['webshare'];
    for (const key of ['direct', 'backbone'] as const) {
      const endpoint = value.webshare?.[key];
      if (!endpoint || !['http', 'socks5'].includes(endpoint.type)) throw new Error('代理协议无效');
      const server = text(endpoint.server, '代理地址', 253);
      if (/[\s/:@]/.test(server)) throw new Error('代理地址只填写 IP 或域名，不包含协议和端口');
      const port = Number(endpoint.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口应在 1 至 65535 之间');
      const username = text(endpoint.username, '代理用户名', 255);
      const password = endpoint.password || current.webshare[key].password;
      if (typeof password !== 'string' || !password || password.length > 1000) throw new Error('代理密码无效');
      webshare[key] = { server, port, type: endpoint.type, username, password };
    }
    const webshareMethod = value.webshareMethod ?? current.webshareMethod ?? 'direct';
    if (!['direct', 'backbone'].includes(webshareMethod)) throw new Error('请选择 Direct 或 Backbone 接入');
    const next: ConnectionStore = { ...current, airports, vpsNodes, webshare, webshareMethod, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() };
    if (value.pinClaude) {
      const front = vpsNodes.find(v => v.id === value.pinClaude!.vpsId);
      const expectedIp = String(value.pinClaude.expectedIp || '').trim();
      if (!front || !isIP(expectedIp)) throw new Error('请选择已配置的 VPS，并填写已核实的固定出口 IP');
      const mode = value.pinClaude.mode || 'webshare';
      if (!['vps', 'webshare'].includes(mode)) throw new Error('请选择 Claude 专用路线');
      next.claude = { mode, vpsId: front.id, expectedIp, pinnedAt: next.updatedAt, frontName: front.name, ...(mode === 'webshare' ? { endpoint: { ...webshare[webshareMethod] } } : {}), front: { ...front.node } };
    }
    await writeConnections(next);
    return next;
  });
  pending = operation;
  return operation;
}
export async function writeConnections(store: ConnectionStore) {
  const file = location();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(store), { mode: 0o600 });
  await rename(temporary, file);
}
// Serialize refreshes with edits so a slow upstream download cannot overwrite a newer form save.
export async function refreshConnections() {
  const operation = pending.catch(() => {}).then(async () => {
    const current = await readConnections();
    if (!current) return null;
    let changed = false;
    const airports = await Promise.all(current.airports.map(async airport => {
      if (airport.refreshedAt && Date.now() - Date.parse(airport.refreshedAt) < 3600000) return airport;
      changed = true;
      try { return { ...airport, nodes: await downloadAirport(airport.url, 8000), refreshedAt: new Date().toISOString(), refreshError: undefined }; }
      catch { return { ...airport, refreshedAt: new Date().toISOString(), refreshError: '最近更新失败，继续使用上次成功的节点；下一小时再更新。' }; }
    }));
    if (!changed) return current;
    const next = { ...current, airports, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() };
    await writeConnections(next);
    return next;
  });
  pending = operation;
  return operation;
}
export async function generateConfiguration(store: ConnectionStore, origin: string, client: 'desktop' | 'ios' = 'desktop') {
  const proxies: Record<string, unknown>[] = [];
  const endpoint = store.webshare[store.webshareMethod || 'direct'];
  if (store.airports.length) proxies.push({ ...endpoint, name: 'Webshare · 机场通道', 'dialer-proxy': '机场节点' });
  const vpsNodes = store.vpsNodes || [];
  if (vpsNodes.length) proxies.push({ ...endpoint, name: 'Webshare · VPS 通道', 'dialer-proxy': 'VPS 节点' });
  proxies.push(...vpsNodes.map(v => ({ ...v.node, name: `自建 VPS｜${v.name}` })));
  const claudeName = store.claude ? `Claude 固定出口｜${store.claude.expectedIp}` : null;
  if (store.claude?.mode === 'vps') proxies.push({ ...store.claude.front, name: claudeName! });
  else if (store.claude) proxies.push(
    { ...store.claude.front, name: 'Claude 专用前置' },
    { ...store.claude.endpoint, name: claudeName!, 'dialer-proxy': 'Claude 专用前置' },
  );
  const providers = Object.fromEntries(store.airports.map((airport) => [airport.id, {
    type: 'inline', payload: airport.nodes,
    override: { 'additional-prefix': `${airport.name}｜` },
    'exclude-filter': '剩余流量|套餐到期|官网|TG群|有超时',
    'health-check': { enable: false, url: 'https://www.gstatic.com/generate_204', interval: 600, lazy: true },
  }]));
  const plans = [
    ...(store.airports.length ? [{ name: '机场＋Webshare', proxy: 'Webshare · 机场通道' }] : []),
    ...(vpsNodes.length ? [{ name: 'VPS＋Webshare', proxy: 'Webshare · VPS 通道' }, { name: '只用 VPS', proxy: 'VPS 节点' }] : []),
    ...(store.airports.length ? [{ name: '只用机场', proxy: '机场节点' }] : []),
  ];
  const groups = [
    { name: '使用方案', type: 'select', proxies: plans.map(p => p.name) },
    ...(store.airports.length ? [{ name: '机场节点', type: 'select', use: store.airports.map(a => a.id), 'empty-fallback': 'REJECT' }] : []),
    ...(vpsNodes.length ? [{ name: 'VPS 节点', type: 'select', hidden: vpsNodes.length === 1, proxies: vpsNodes.map(v => `自建 VPS｜${v.name}`) }] : []),
    ...plans.map(p => ({ name: p.name, type: 'select', hidden: true, proxies: [p.proxy] })),
  ];
  const policy = await readPolicyStore();
  const privateRules = [
    `DOMAIN,${new URL(origin).hostname},DIRECT`,
    'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve', 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'IP-CIDR,100.64.0.0/10,DIRECT,no-resolve', 'IP-CIDR,169.254.0.0/16,DIRECT,no-resolve',
    'IP-CIDR6,::1/128,DIRECT,no-resolve', 'IP-CIDR6,fc00::/7,DIRECT,no-resolve', 'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  ];
  const ruleProviders = Object.fromEntries(['direct', 'proxy'].map((action) => [
    `hub-${action}`, { type: 'http', behavior: 'classical', format: 'yaml', url: `${origin}/rules/${action}.yaml`, path: `./rule_providers/hub-${action}.yaml`, interval: 300, proxy: 'DIRECT', payload: policy.policies.filter(p => p.enabled && p.action === action.toUpperCase()).flatMap(p => p.matchers.map(m => `${m.type},${m.value}${m.noResolve ? ',no-resolve' : ''}`)) },
  ]));
  const config = {
    ...JSON.parse(JSON.stringify(store.defaults).replaceAll('#固定出口', '#使用方案').replaceAll('#出口模式', '#使用方案')), 'mixed-port': 7897, 'allow-lan': false, mode: 'rule', 'log-level': 'warning', ipv6: false,
    profile: { 'store-selected': true },
    proxies, 'proxy-providers': providers, 'proxy-groups': groups,
    listeners: [
      { name: 'AI 专用出口', type: 'mixed', listen: '127.0.0.1', port: 17897, proxy: '使用方案' },
      ...(claudeName ? [{ name: 'Claude 专用入口', type: 'mixed', listen: '127.0.0.1', port: 17997, proxy: claudeName }] : []),
    ],
    'rule-providers': {
      ...ruleProviders,
      'china-domains': { type: 'http', behavior: 'domain', format: 'mrs', url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs', path: './rule_providers/china-domains.mrs', interval: 86400, proxy: '使用方案' },
      'china-ips': { type: 'http', behavior: 'ipcidr', format: 'mrs', url: 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.mrs', path: './rule_providers/china-ips.mrs', interval: 86400, proxy: '使用方案' },
    },
    rules: [...privateRules, 'RULE-SET,hub-direct,DIRECT', 'RULE-SET,hub-proxy,使用方案', 'RULE-SET,china-domains,DIRECT', 'RULE-SET,china-ips,DIRECT', 'MATCH,使用方案'],
  };
  if (client === 'desktop') return config;
  if (!claudeName) throw new Error('请先设置 Claude 固定出口，再导入手机订阅');
  // iOS uses domain routing instead of the Mac's dedicated local listeners.
  for (const key of ['listeners', 'external-controller', 'external-controller-tls', 'external-controller-unix', 'external-ui', 'external-ui-url', 'secret', 'port', 'socks-port', 'redir-port', 'tproxy-port']) delete config[key];
  config.tun = { enable: true, stack: 'mixed', 'auto-route': true, 'strict-route': true, 'dns-hijack': ['any:53', 'tcp://any:53'] };
  const resolver = `https://1.1.1.1/dns-query#${claudeName}`;
  config.dns = {
    enable: true, ipv6: false, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16',
    'default-nameserver': ['1.1.1.1', '1.0.0.1'],
    'proxy-server-nameserver': [resolver], nameserver: [resolver],
    'fake-ip-filter': ['*.lan', '*.local', 'localhost'],
  };
  const domains = ['claude.ai', 'claude.com', 'anthropic.com', 'claudeusercontent.com', 'claudeusercontent.net', 'claudemcpclient.com'];
  config.rules.unshift(...domains.map(domain => `DOMAIN-SUFFIX,${domain},${claudeName}`), `DOMAIN,ipv4.webshare.io,${claudeName}`);
  // Match the verified phone's initial daily plan; stored client selections persist.
  const plan = groups.find(group => group.name === '使用方案');
  if (plan?.proxies?.includes('只用 VPS')) plan.proxies = ['只用 VPS', ...plan.proxies.filter(name => name !== '只用 VPS')];
  const vps = groups.find(group => group.name === 'VPS 节点');
  const hysteria = vpsNodes.find(node => node.node.type === 'hysteria2');
  if (vps?.proxies && hysteria) {
    const name = `自建 VPS｜${hysteria.name}`;
    vps.proxies = [name, ...vps.proxies.filter(value => value !== name)];
  }
  return config;
}
