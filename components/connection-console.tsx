'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { HubNav, NextLink } from '@/components/hub-nav';
import { UsageGuide } from '@/components/usage-guide';
import { parseEndpoint } from '@/lib/endpoint-import';
import type { Endpoint } from '@/lib/connections';
import { beijingTime as time } from '@/lib/display-time';

type View = {
  configured: boolean;
  updatedAt: string;
  claude?: { sourceChanged: boolean; expectedIp: string } | null;
  webshareMethod?: 'direct' | 'backbone';
  webshare: {
    direct: Endpoint & { hasPassword?: boolean };
    backbone: Endpoint & { hasPassword?: boolean };
  };
  vpsNodes?: {
    id: string;
    name: string;
    shareUrl: string;
    hasConfig?: boolean;
    server?: string;
    port?: number;
  }[];
  airports: {
    id: string;
    name: string;
    url: string;
    hasUrl?: boolean;
    nodeCount?: number;
    refreshedAt?: string;
    refreshError?: string;
  }[];
};
const plans = [
  {
    name: '机场＋Webshare',
    path: '家里 → 机场 → Webshare',
    exit: 'Webshare 固定 IP',
    note: '换机场、换地区，不改变最终 IP',
    needs: 'airport',
  },
  {
    name: 'VPS＋Webshare',
    path: '家里 → VPS → Webshare',
    exit: 'Webshare 固定 IP',
    note: '用自建 VPS 连接固定出口',
    needs: 'vps',
  },
  {
    name: '只用 VPS',
    path: '家里 → VPS',
    exit: 'VPS 的 IP',
    note: '不经过机场和 Webshare',
    needs: 'vps',
  },
  {
    name: '只用机场',
    path: '家里 → 所选机场节点',
    exit: '机场节点的 IP',
    note: '换地区会改变最终出口',
    needs: 'airport',
  },
];
async function readView(authorization: string): Promise<View> {
  const response = await fetch('/api/connections', {
    headers: { 'x-admin-password': authorization },
    cache: 'no-store',
  });
  const next = await response.json();
  if (!response.ok) throw new Error(next.error);
  return next;
}
function EndpointImport({
  onImport,
}: {
  onImport: (endpoint: Endpoint) => void;
}) {
  const [value, setValue] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="rounded-xl bg-muted/60 p-4">
      <label htmlFor="endpoint-import" className="block text-sm font-medium">
        粘贴官网连接参数
        <Input
          id="endpoint-import"
          type="password"
          autoComplete="off"
          className="mt-2"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          placeholder="官网 curl 命令、代理 URL 或 地址:端口:用户名:密码"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!value.trim()}
          onClick={() => {
            try {
              onImport(parseEndpoint(value));
              setValue('');
              setError('已识别，保存并发布后生效。');
            } catch (e) {
              setError(e instanceof Error ? e.message : '无法识别');
            }
          }}
        >
          识别并填入
        </Button>
        <p className="text-xs text-muted-foreground">
          只在浏览器解析，保存前不会提交。
        </p>
      </div>
      {error && <output className="mt-3 block text-sm">{error}</output>}
    </div>
  );
}

export function ConnectionConsole({
  overview = false,
}: {
  overview?: boolean;
}) {
  const [password, setPassword] = useState(''),
    [data, setData] = useState<View | null>(null);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<'webshare' | 'airport' | 'vps' | null>(
    null,
  );
  const [method, setMethod] = useState<'direct' | 'backbone'>('direct');
  const authorization = () =>
    password || sessionStorage.getItem('route-list-password') || '';
  async function load(supplied = '') {
    setBusy(true);
    setMessage('');
    try {
      const auth = supplied || authorization(),
        next = await readView(auth);
      sessionStorage.setItem('route-list-password', auth);
      setData(next);
      setMethod(next.webshareMethod || 'direct');
      setPassword('');
      setDirty(false);
      setEditing(null);
      if (!next.configured) setMessage('尚未配置，请先导入已验证的连接。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '读取失败');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const auth = sessionStorage.getItem('route-list-password');
    if (!auth) return;
    let active = true;
    readView(auth)
      .then((next) => {
        if (active) {
          setData(next);
          setMethod(next.webshareMethod || 'direct');
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function change(next: View) {
    setData(next);
    setDirty(true);
  }
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/connections', {
        method: 'PUT',
        headers: {
          'x-admin-password': authorization(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      const next = await r.json();
      if (!r.ok) throw new Error(next.error);
      setData(next);
      setDirty(false);
      setEditing(null);
      setMessage(
        next.removedNodeCount > 0
          ? `已保存并发布，${next.removedNodeCount} 个原节点已移除或改名。刷新 Clash 后请重新检查节点选择；无需重新导入订阅。`
          : '已保存并发布。现在到 Clash 刷新「日常网络 · 网站管理」，继续使用原方案；无需重新导入订阅。',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '发布失败，原配置继续保留');
    } finally {
      setBusy(false);
    }
  }
  async function copySubscription() {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'x-admin-password': authorization() },
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await navigator.clipboard.writeText(result.url);
      setMessage(
        '已复制。仅首次接入新设备需要导入；更换参数后刷新已有订阅即可。地址包含私人令牌，请勿分享。',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '复制失败');
    } finally {
      setBusy(false);
    }
  }
  const airports = data?.configured ? data.airports : [],
    vpsNodes = data?.vpsNodes || [];
  const defaultPlan =
    data?.configured && !airports.length ? 'VPS＋Webshare' : '机场＋Webshare';
  const endpoint = data?.configured ? data.webshare[method] : null;
  function updateEndpoint(patch: Partial<Endpoint>) {
    if (data?.configured)
      change({
        ...data,
        webshare: {
          ...data.webshare,
          [method]: { ...data.webshare[method], ...patch },
        },
      });
  }
  return (
    <main className="min-h-screen bg-background text-foreground">
      <HubNav active={overview ? 'overview' : 'connections'} />
      <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-7 sm:py-10">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium tracking-widest text-primary">
              {overview ? '日常使用' : '更换与更新'}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {overview ? '选一种方案，就能用' : '换好参数，刷新一次'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {overview
                ? '在 Clash 的「使用方案」切换；用到机场时，再选一个机场节点。'
                : '订阅地址始终不变。网站保存并发布后，在 Clash 刷新已有的日常订阅。'}
            </p>
          </div>
          {data?.configured && (
            <Button
              variant="outline"
              onClick={() => void copySubscription()}
              disabled={busy || dirty}
            >
              <Copy className="size-4" />
              首次接入：复制订阅
            </Button>
          )}
        </header>
        {!data ? (
          <section className="mb-6 rounded-2xl border bg-card p-5">
            <h2 className="font-medium">解锁管理</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              使用现有管理密码，查看已保存的连接和发布记录。
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label
                htmlFor="management-password"
                className="min-w-44 flex-1 text-sm"
              >
                管理密码
                <Input
                  id="management-password"
                  type="password"
                  autoComplete="current-password"
                  className="mt-2"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busy) void load(password);
                  }}
                />
              </label>
              <Button disabled={busy} onClick={() => void load(password)}>
                <KeyRound className="size-4" />
                解锁
              </Button>
            </div>
          </section>
        ) : (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              已解锁 · NAS 配置 {time(data.updatedAt)}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || dirty}
                onClick={() => void load()}
              >
                <RefreshCw className="size-3.5" />
                重新读取
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || dirty}
                onClick={() => {
                  sessionStorage.removeItem('route-list-password');
                  setData(null);
                  setPassword('');
                  setEditing(null);
                  setMessage('');
                }}
              >
                <LockKeyhole className="size-3.5" />
                锁定
              </Button>
            </div>
          </div>
        )}
        {message && (
          <output
            aria-live="polite"
            className="mb-6 block rounded-xl border border-primary/25 bg-card px-4 py-4 text-sm leading-6"
          >
            {message}
          </output>
        )}
        {overview ? (
          <>
            <section
              aria-label="四种使用方案"
              className="mb-6 grid gap-4 sm:grid-cols-2"
            >
              {plans.map((plan, index) => {
                const available = data?.configured
                  ? plan.needs === 'vps'
                    ? vpsNodes.length > 0
                    : airports.length > 0
                  : null;
                return (
                  <article
                    key={plan.name}
                    className={`rounded-2xl border p-6 ${plan.name === defaultPlan ? 'border-primary/30 bg-primary text-primary-foreground' : 'bg-card'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs opacity-70">
                        方案 0{index + 1}
                      </span>
                      {plan.name === defaultPlan && (
                        <span className="rounded-full bg-white/15 px-3 py-1 text-xs">
                          默认方案
                        </span>
                      )}
                    </div>
                    <h2 className="mt-5 text-xl font-semibold">{plan.name}</h2>
                    <p className="mt-3 text-sm opacity-75">{plan.path}</p>
                    <p className="mt-6 text-xs opacity-70">最终出口</p>
                    <p className="mt-1 font-medium">{plan.exit}</p>
                    <p className="mt-3 text-sm opacity-75">{plan.note}</p>
                    {available !== null && (
                      <p className="mt-4 border-t border-current/15 pt-3 text-xs opacity-75">
                        {available
                          ? '已配置；实际连接请在 Clash 查看'
                          : '尚未添加相应连接，Clash 暂不显示此方案'}
                      </p>
                    )}
                  </article>
                );
              })}
            </section>
            <section className="mb-6 grid gap-6 rounded-2xl border bg-card p-6 sm:grid-cols-2">
              <div>
                <h2 className="font-semibold">Clash 平时只看两处</h2>
                <ol className="mt-4 space-y-3 text-sm leading-6">
                  <li>
                    <strong>① 使用方案</strong>：选上面一种。
                  </li>
                  <li>
                    <strong>② 机场节点</strong>
                    ：需要机场时，直接选「拼好连｜日本…」或「雪山｜日本…」。
                  </li>
                </ol>
                <p className="mt-4 text-xs leading-6 text-muted-foreground">
                  只有一台 VPS 时无需再选。Direct / Backbone
                  在网站维护，不用每天切换。方案失败时不会自动更换出口。
                </p>
              </div>
              <div>
                <h2 className="font-semibold">换参数，也不用重新搭配</h2>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  更换配置 → 保存并发布 → Clash
                  刷新一次。后续更新保留有效的方案和节点选择；原节点被移除时，需要在
                  Clash 重新选择。
                </p>
                <div className="mt-4">
                  <NextLink href="/connections">去更换配置</NextLink>
                </div>
                <div className="mt-3">
                  <NextLink href="/policies">管理网站分流例外</NextLink>
                </div>
              </div>
            </section>
            <UsageGuide />
          </>
        ) : (
          data?.configured && (
            <>
              <details className="mb-6 rounded-2xl border bg-card p-5"><summary className="cursor-pointer font-semibold">切换方法与四种使用方案</summary><h2 className="sr-only">日常的四种使用方案</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">在 Clash 选择「使用方案」；需要机场时，再选「机场节点」。这里的选择不影响 Claude 专用入口。</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{plans.map(plan => <div key={plan.name} className="rounded-xl bg-muted/50 p-4"><h3 className="text-sm font-medium">{plan.name}</h3><p className="mt-2 text-xs text-muted-foreground">{plan.path} · 出口：{plan.exit}</p></div>)}</div></details>
              {airports.some(a => a.refreshError) && <section aria-label="配置提醒" className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
                <h2 className="font-semibold">机场订阅需要检查</h2>
                {airports.filter(a => a.refreshError).map(a => <p key={a.id} className="mt-2 text-sm leading-7">{a.name}：最近更新失败，当前继续使用缓存的 {a.nodeCount ?? 0} 个节点。请到官网核对订阅，再在下方更换。</p>)}
                <Button variant="outline" className="mt-3" onClick={() => setEditing('airport')}>查看机场配置</Button>
              </section>}
              {data.claude?.sourceChanged && <section aria-label="配置提醒" className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
                <h2 className="font-semibold">Claude 仍使用原固定配置</h2>
                <p className="mt-2 text-sm leading-7">日常连接参数已变更，Claude 的独立副本未同步。原固定出口为 {data.claude.expectedIp}；确认新路线后，再单独更新。</p>
                <div className="mt-3"><NextLink href="/">检查并更新 Claude 固定配置</NextLink></div>
              </section>}
              <section
                className="mb-7 rounded-2xl border bg-card p-5 sm:p-6"
                aria-label="更新进度"
              >
                <div className="grid gap-5 sm:grid-cols-3">
                  <div>
                    <p className="text-sm font-medium">
                      {dirty ? '① 有未发布的修改' : '① 网站已发布'}
                    </p>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      {dirty
                        ? '保存成功前，已有订阅不受影响'
                        : `发布时间 ${time(data.updatedAt)}（北京时间）`}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">② Clash 刷新订阅</p>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      订阅页 → 日常网络 · 网站管理 → 刷新
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">③ 本机检查出口与服务</p>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      网站未连接本机 Clash，无法确认已应用或实测通过
                    </p>
                  </div>
                </div>
              </section>
              <section
                className="mb-6 grid gap-4 md:grid-cols-3"
                aria-label="选择要更换的连接"
              >
                {(
                  [
                    [
                      'webshare',
                      '更换 Webshare',
                      `${(data.webshareMethod || 'direct') === 'direct' ? 'Direct' : 'Backbone'} · ${data.webshare[data.webshareMethod || 'direct'].server}`,
                      '粘贴官网参数，更新固定出口',
                    ],
                    [
                      'airport',
                      '更换机场',
                      airports.map((a) => a.name).join(' / ') || '尚未添加',
                      '粘贴订阅，成功读取后替换',
                    ],
                    [
                      'vps',
                      '更换 VPS 节点',
                      vpsNodes.map((v) => v.name).join(' / ') || '尚未添加',
                      '粘贴已部署的代理节点链接',
                    ],
                  ] as const
                ).map(([key, title, summary, note]) => (
                  <button
                    key={key}
                    disabled={busy}
                    onClick={() => setEditing(editing === key ? null : key)}
                    aria-expanded={editing === key}
                    aria-controls={`edit-${key}`}
                    className={`rounded-2xl border p-5 text-left transition-colors hover:border-primary/50 ${editing === key ? 'border-primary bg-secondary/50' : 'bg-card'}`}
                  >
                    <span className="flex items-center justify-between font-semibold">
                      {title}
                      <Pencil className="size-4" />
                    </span>
                    <span className="mt-4 block break-all text-sm">
                      {summary}
                    </span>
                    <span className="mt-2 block text-xs leading-6 text-muted-foreground">
                      {note}
                    </span>
                  </button>
                ))}
              </section>
              {editing === 'webshare' && endpoint && (
                <section
                  id="edit-webshare"
                  className="mb-6 rounded-2xl border bg-card p-5 sm:p-6"
                >
                  <h2 className="text-lg font-semibold">更换 Webshare</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    先选择官网的连接方式，再粘贴对应参数。当前发布使用{' '}
                    {data.webshareMethod || 'direct'}。
                  </p>
                  <fieldset disabled={busy} className="mt-5 space-y-5">
                    <div className="flex flex-wrap gap-2">
                      {(['direct', 'backbone'] as const).map((key) => (
                        <Button
                          key={key}
                          type="button"
                          variant={method === key ? 'default' : 'outline'}
                          onClick={() => {
                            setMethod(key);
                            change({ ...data, webshareMethod: key });
                          }}
                        >
                          {key === 'direct' ? 'Direct' : 'Backbone'}
                        </Button>
                      ))}
                    </div>
                    <EndpointImport key={method} onImport={updateEndpoint} />
                    <details className="rounded-xl border">
                      <summary className="flex cursor-pointer items-center justify-between p-4 text-sm font-medium">
                        手动填写 / 核对识别结果
                        <ChevronDown className="size-4" />
                      </summary>
                      <div className="grid gap-4 border-t p-4 sm:grid-cols-2">
                        <label htmlFor="proxy-server" className="text-sm">
                          代理地址
                          <Input
                            id="proxy-server"
                            className="mt-2"
                            value={endpoint.server}
                            onChange={(e) =>
                              updateEndpoint({ server: e.target.value })
                            }
                          />
                        </label>
                        <label htmlFor="proxy-port" className="text-sm">
                          端口
                          <Input
                            id="proxy-port"
                            className="mt-2"
                            type="number"
                            min={1}
                            max={65535}
                            value={endpoint.port}
                            onChange={(e) =>
                              updateEndpoint({ port: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label htmlFor="proxy-type" className="text-sm">
                          协议
                          <NativeSelect
                            id="proxy-type"
                            className="mt-2 w-full"
                            value={endpoint.type}
                            onChange={(e) =>
                              updateEndpoint({
                                type: e.target.value as Endpoint['type'],
                              })
                            }
                          >
                            <NativeSelectOption value="http">
                              HTTP
                            </NativeSelectOption>
                            <NativeSelectOption value="socks5">
                              SOCKS5
                            </NativeSelectOption>
                          </NativeSelect>
                        </label>
                        <label htmlFor="proxy-username" className="text-sm">
                          用户名
                          <Input
                            id="proxy-username"
                            className="mt-2"
                            autoComplete="off"
                            value={endpoint.username}
                            onChange={(e) =>
                              updateEndpoint({ username: e.target.value })
                            }
                          />
                        </label>
                        <label
                          htmlFor="proxy-password"
                          className="text-sm sm:col-span-2"
                        >
                          密码
                          <Input
                            id="proxy-password"
                            className="mt-2"
                            type="password"
                            autoComplete="new-password"
                            value={endpoint.password}
                            placeholder={
                              endpoint.hasPassword
                                ? '已保存；留空保留'
                                : '填写密码'
                            }
                            onChange={(e) =>
                              updateEndpoint({ password: e.target.value })
                            }
                          />
                        </label>
                      </div>
                    </details>
                    <p className="text-xs leading-6 text-muted-foreground">
                      发布后，两个 Webshare 方案统一使用此处选择的{' '}
                      {method === 'direct' ? 'Direct' : 'Backbone'} 端点，无需到
                      Clash 分别配置。
                    </p>
                  </fieldset>
                </section>
              )}
              {editing === 'airport' && (
                <section
                  id="edit-airport"
                  className="mb-6 rounded-2xl border bg-card p-5 sm:p-6"
                >
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">更换机场</h2>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        change({
                          ...data,
                          airports: [
                            ...airports,
                            {
                              id: `airport-${crypto.randomUUID()}`,
                              name: '',
                              url: '',
                            },
                          ],
                        })
                      }
                    >
                      <Plus className="size-4" />
                      添加机场
                    </Button>
                  </div>
                  <p className="mb-5 text-sm leading-6 text-muted-foreground">
                    替换现有机场时保留名称，只填新订阅。新订阅读取失败时不会发布，原配置继续保留。
                  </p>
                  <fieldset disabled={busy} className="space-y-4">
                    {airports.map((a, index) => (
                      <div key={a.id} className="rounded-xl border p-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label
                            htmlFor={`airport-name-${a.id}`}
                            className="text-sm"
                          >
                            机场名称
                            <Input
                              id={`airport-name-${a.id}`}
                              className="mt-2"
                              value={a.name}
                              onChange={(e) =>
                                change({
                                  ...data,
                                  airports: airports.map((x) =>
                                    x.id === a.id
                                      ? { ...x, name: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label
                            htmlFor={`airport-url-${a.id}`}
                            className="text-sm"
                          >
                            Clash / Mihomo 订阅地址
                            <Input
                              id={`airport-url-${a.id}`}
                              className="mt-2"
                              type="password"
                              autoComplete="off"
                              value={a.url}
                              placeholder={
                                a.hasUrl
                                  ? '已保存；留空保留原地址'
                                  : '粘贴新订阅地址'
                              }
                              onChange={(e) =>
                                change({
                                  ...data,
                                  airports: airports.map((x) =>
                                    x.id === a.id
                                      ? { ...x, url: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p
                            className={`text-xs ${a.refreshError ? 'text-amber-700' : 'text-muted-foreground'}`}
                          >
                            {a.refreshError
                              ? `上次更新失败 · 缓存 ${a.nodeCount ?? 0} 个节点`
                              : `${a.nodeCount ?? 0} 个节点 · ${time(a.refreshedAt)}`}
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`移除机场 ${a.name || index + 1}`}
                            disabled={airports.length <= 1 && !vpsNodes.length}
                            onClick={() =>
                              change({
                                ...data,
                                airports: airports.filter((x) => x.id !== a.id),
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                            移除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </fieldset>
                </section>
              )}
              {editing === 'vps' && (
                <section
                  id="edit-vps"
                  className="mb-6 rounded-2xl border bg-card p-5 sm:p-6"
                >
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">更换 VPS 节点</h2>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        change({
                          ...data,
                          vpsNodes: [
                            ...vpsNodes,
                            {
                              id: `vps-${crypto.randomUUID()}`,
                              name: '',
                              shareUrl: '',
                            },
                          ],
                        })
                      }
                    >
                      <Plus className="size-4" />
                      添加 VPS
                    </Button>
                  </div>
                  <p className="mb-5 text-sm leading-6 text-muted-foreground">
                    粘贴安装好代理服务后的 VLESS REALITY 或 Hysteria2 链接。这里不填写 SSH
                    或 root 密码。
                  </p>
                  <fieldset disabled={busy} className="space-y-4">
                    {vpsNodes.map((v, index) => (
                      <div key={v.id} className="rounded-xl border p-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label
                            htmlFor={`vps-name-${v.id}`}
                            className="text-sm"
                          >
                            VPS 名称
                            <Input
                              id={`vps-name-${v.id}`}
                              className="mt-2"
                              value={v.name}
                              placeholder="例如：Legend SG"
                              onChange={(e) =>
                                change({
                                  ...data,
                                  vpsNodes: vpsNodes.map((x) =>
                                    x.id === v.id
                                      ? { ...x, name: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label
                            htmlFor={`vps-link-${v.id}`}
                            className="text-sm"
                          >
                            代理节点链接
                            <Input
                              id={`vps-link-${v.id}`}
                              className="mt-2"
                              type="password"
                              autoComplete="off"
                              value={v.shareUrl}
                              placeholder={
                                v.hasConfig
                                  ? '已保存；留空保留原节点'
                                  : '粘贴 vless:// 或 hysteria2:// 节点链接'
                              }
                              onChange={(e) =>
                                change({
                                  ...data,
                                  vpsNodes: vpsNodes.map((x) =>
                                    x.id === v.id
                                      ? { ...x, shareUrl: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            {v.hasConfig ? `${v.server}:${v.port}` : '尚未发布'}
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`移除 VPS ${v.name || index + 1}`}
                            disabled={vpsNodes.length <= 1 && !airports.length}
                            onClick={() =>
                              change({
                                ...data,
                                vpsNodes: vpsNodes.filter((x) => x.id !== v.id),
                              })
                            }
                          >
                            <Trash2 className="size-3.5" />
                            移除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </fieldset>
                </section>
              )}
              <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
                <div>
                  <h2 className="font-medium">只换地区？不用改网站</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Clash →
                    机场节点，直接选择机场和地区。需要直连的网站或应用在「网站例外」管理。
                  </p>
                </div>
                <NextLink href="/policies">管理网站例外</NextLink>
              </section>
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-4 shadow-lg backdrop-blur">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {dirty ? (
                      <Pencil className="size-4" />
                    ) : (
                      <Check className="size-4 text-primary" />
                    )}
                    {dirty ? '修改尚未发布' : '网站配置已发布'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dirty
                      ? '发布后，在 Clash 刷新一次即可使用'
                      : '无需重新导入订阅；本机应用状态请在 Clash 确认'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {dirty && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void load()}
                    >
                      放弃修改
                    </Button>
                  )}
                  <Button disabled={busy || !dirty} onClick={() => void save()}>
                    <Save className="size-4" />
                    {busy ? '校验并发布中…' : '保存并发布'}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </main>
  );
}
