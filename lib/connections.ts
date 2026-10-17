import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { readPolicyStore } from './policies';

type Node = Record<string, unknown> & { name: string };
export type Endpoint = { server: string; port: number; type: 'http' | 'socks5'; username: string; password: string };
type Airport = { id: string; name: string; url: string; nodes: Node[]; refreshedAt?: string; refreshError?: string };
export type ConnectionStore = {
  version: 1; updatedAt: string; token: string;
  webshare: { direct: Endpoint; backbone: Endpoint };
  airports: Airport[];
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
  return {
    configured: true, updatedAt: store.updatedAt,
    webshare: Object.fromEntries(Object.entries(store.webshare).map(([key, endpoint]) => [key, { ...endpoint, password: '', hasPassword: Boolean(endpoint.password) }])),
    airports: store.airports.map(({ id, name, nodes, refreshedAt, refreshError }) => ({ id, name, nodeCount: nodes.length, url: '', hasUrl: true, refreshedAt, refreshError })),
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
    const value = input as { updatedAt: string; webshare: Record<string, Endpoint>; airports: { id: string; name: string; url: string }[] };
    if (value.updatedAt !== current.updatedAt) throw new Error('配置已被其他页面修改，请重新读取后再保存');
    if (!Array.isArray(value.airports) || !value.airports.length || value.airports.length > 10) throw new Error('请保留 1 至 10 个机场');
    const names = new Set<string>();
    const ids = new Set<string>();
    const airports: Airport[] = [];
    for (const item of value.airports) {
      const id = text(item.id, '机场标识', 80);
      if (!/^[a-z0-9-]+$/.test(id) || ids.has(id)) throw new Error('机场标识无效或重复');
      ids.add(id);
      const name = text(item.name, '机场名称', 40);
      if (names.has(name) || ['固定出口', '前置机场', '订阅更新通道'].includes(name) || /[,|]/.test(name)) throw new Error('机场名称重复或包含保留字符');
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
    const next: ConnectionStore = { ...current, airports, webshare, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString() };
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
export async function generateConfiguration(store: ConnectionStore, origin: string) {
  const proxies: Record<string, unknown>[] = [];
  const exitNames = [`Webshare Direct ${store.webshare.direct.type.toUpperCase()}`, `Webshare Backbone ${store.webshare.backbone.type.toUpperCase()}`];
  for (const [index, key] of (['direct', 'backbone'] as const).entries()) proxies.push({ ...store.webshare[key], name: exitNames[index], 'dialer-proxy': '前置机场' });
  const providers = Object.fromEntries(store.airports.map((airport) => [airport.id, {
    type: 'inline', payload: airport.nodes,
    override: { 'additional-prefix': `${airport.name}｜` },
    'exclude-filter': '剩余流量|套餐到期|官网|TG群|有超时',
    'health-check': { enable: false, url: 'https://www.gstatic.com/generate_204', interval: 600, lazy: true },
  }]));
  const groups = [
    { name: '固定出口', type: 'select', proxies: exitNames },
    { name: '前置机场', type: 'select', proxies: store.airports.map((a) => `${a.name}节点`) },
    ...store.airports.map((a) => ({ name: `${a.name}节点`, type: 'select', use: [a.id] })),
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
  return {
    ...store.defaults, 'mixed-port': 7897, 'allow-lan': false, mode: 'rule', 'log-level': 'warning', ipv6: false,
    profile: { 'store-selected': true },
    proxies, 'proxy-providers': providers, 'proxy-groups': groups,
    listeners: [{ name: '固定 AI 出口', type: 'mixed', listen: '127.0.0.1', port: 17897, proxy: '固定出口' }],
    'rule-providers': ruleProviders,
    rules: [...privateRules, 'RULE-SET,hub-proxy,固定出口', 'RULE-SET,hub-direct,DIRECT', 'MATCH,固定出口'],
  };
}
