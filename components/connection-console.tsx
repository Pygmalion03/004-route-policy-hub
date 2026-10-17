'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, Clock3, Copy, KeyRound, LockKeyhole, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { HubNav, NextLink } from '@/components/hub-nav';
import { UsageGuide } from '@/components/usage-guide';
import type { Endpoint } from '@/lib/connections';

type View = {
  configured: boolean; updatedAt: string;
  webshare: { direct: Endpoint & { hasPassword?: boolean }; backbone: Endpoint & { hasPassword?: boolean } };
  vpsNodes?: { id: string; name: string; shareUrl: string; hasConfig?: boolean; server?: string; port?: number }[];
  airports: { id: string; name: string; url: string; hasUrl?: boolean; nodeCount?: number; refreshedAt?: string; refreshError?: string }[];
};
const time = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '暂无更新记录';

async function readView(authorization: string): Promise<View> {
  const response = await fetch('/api/connections', { headers: { 'x-admin-password': authorization }, cache: 'no-store' });
  const next = await response.json();
  if (!response.ok) throw new Error(next.error);
  return next;
}

export function ConnectionConsole({ overview = false }: { overview?: boolean }) {
  const [password, setPassword] = useState('');
  const [data, setData] = useState<View | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const headers = () => ({ 'x-admin-password': password || sessionStorage.getItem('route-list-password') || '', 'content-type': 'application/json' });
  async function load(suppliedPassword = '') {
    const authorization = suppliedPassword || sessionStorage.getItem('route-list-password') || '';
    try {
      const next = await readView(authorization);
      setMessage('');
      sessionStorage.setItem('route-list-password', authorization);
      setData(next); setPassword(''); setDirty(false);
      if (!next.configured) setMessage('尚未导入连接配置。请先从本机导入已验证的配置。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取失败'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const authorization = sessionStorage.getItem('route-list-password');
    if (!authorization) return;
    let active = true;
    readView(authorization).then(next => {
      if (!active) return;
      setData(next);
      if (!next.configured) setMessage('尚未导入连接配置。请先从本机导入已验证的配置。');
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : '读取失败');
    });
    return () => { active = false; };
  }, []);
  function beginLoad(suppliedPassword = '') {
    setBusy(true); setMessage(''); void load(suppliedPassword);
  }
  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/connections', { method: 'PUT', headers: headers(), body: JSON.stringify(data) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setData(next); setDirty(false); setMessage('已保存到 NAS。下一步：在 Clash 订阅页刷新「日常 · 域名管理 · Webshare」。仅保存网页不会立即切换本机连接。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function copySubscription() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/connections', { method: 'POST', headers: headers() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await navigator.clipboard.writeText(result.url);
      setMessage('已复制专用配置地址。已有这条日常订阅时直接刷新；新设备首次导入时才需粘贴。地址包含独立令牌，请勿分享。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '复制失败'); }
    finally { setBusy(false); }
  }
  function updateEndpoint(key: 'direct' | 'backbone', patch: Partial<Endpoint>) {
    if (!data) return;
    setData({ ...data, webshare: { ...data.webshare, [key]: { ...data.webshare[key], ...patch } } }); setDirty(true);
  }
  function lock() {
    sessionStorage.removeItem('route-list-password'); setData(null); setPassword(''); setMessage('');
  }
  const airports = data?.configured ? data.airports : [];
  const vpsNodes = data?.vpsNodes || [];
  const failed = airports.filter(airport => airport.refreshError);

  return <main className="min-h-screen bg-background text-foreground">
    <HubNav active={overview ? 'overview' : 'connections'} />
    <div className="mx-auto max-w-[1180px] px-5 py-7 sm:px-7 sm:py-9">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><p className="mb-2 text-xs font-medium tracking-widest text-primary">{overview ? '日常使用' : '参数维护'}</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{overview ? '机场、VPS 与固定出口，按需选择' : '连接配置'}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{overview ? '在这里维护节点与分流，在 Clash 手动选择出口方式和前置线路。' : '先查看已保存的摘要，需要更换时再展开编辑。保存后到 Clash 刷新日常订阅。'}</p></div>
        {data?.configured && <Button onClick={() => void copySubscription()} disabled={busy || dirty} variant="outline"><Copy className="size-4" />复制 Clash 配置地址</Button>}
      </header>

      {data ? <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
        <span className="flex items-center gap-2 text-primary"><ShieldCheck className="size-4" />已解锁<span className="hidden text-muted-foreground sm:inline">· {overview ? '以下为 NAS 已保存配置' : `上次保存 ${time(data.updatedAt)}`}</span></span>
        <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={busy || dirty} onClick={() => beginLoad()}><RefreshCw className="size-3.5" />重新读取</Button><Button size="sm" variant="ghost" disabled={busy || dirty} onClick={lock}><LockKeyhole className="size-3.5" />锁定</Button></div>
      </div> : <section className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-5">
        <div className="w-full"><h2 className="font-medium">解锁已保存的配置</h2><p className="mt-1 text-sm text-muted-foreground">使用现有管理密码。同一标签页内切换页面无需重复输入。</p></div>
        <label htmlFor="connection-password" className="min-w-44 flex-1 text-sm">管理密码<Input id="connection-password" className="mt-2" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !busy) beginLoad(password); }} /></label>
        <Button onClick={() => beginLoad(password)} disabled={busy}><KeyRound className="size-4" />{busy ? '正在读取…' : '解锁配置'}</Button>
      </section>}
      {message && <output aria-live="polite" className="mb-6 block rounded-xl border bg-card px-4 py-3 text-sm leading-6">{message}</output>}

      {overview ? <>
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <section className="rounded-2xl border bg-primary p-5 text-primary-foreground">
            <ShieldCheck className="mb-5 size-5 opacity-80" /><h2 className="text-sm opacity-80">默认出口策略</h2><p className="mt-1 text-xl font-semibold">Webshare · 可选直出</p><p className="mt-3 text-sm leading-6 opacity-80">默认保留 Webshare。只有手动切换「出口模式」，才使用 VPS 或机场直出；失败不自动换出口。</p>
          </section>
          <section className="rounded-2xl border bg-card p-5">
            <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4" />机场订阅缓存</p><h2 className="text-xl font-semibold">{data?.configured ? `${airports.length} 个机场 · ${vpsNodes.length} 个 VPS` : '解锁后查看'}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{data?.configured ? airports.map(a => a.name).join(' / ') : '查看已有机场及最近一次订阅更新结果。'}</p>
          </section>
          <section className="rounded-2xl border bg-card p-5">
            <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />什么时候生效</p><h2 className="text-xl font-semibold">改连接后，刷新 Clash</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">连接订阅当前每天自动下载；手动修改后立即刷新。分流规则约每五分钟更新。</p>
          </section>
        </div>
        <div className="mb-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">平时只需这三步</h2>
            <ol className="mt-5 space-y-5">
              {[
                ['选择出口模式', '保持启用日常订阅，在 Clash 的「出口模式」选固定出口、VPS 直出或机场直出。可用选项取决于已添加的节点。'],
                ['使用 Webshare 时，选择前置线路', '「固定出口」模式下，在「前置线路」选机场或自建 VPS；再到对应的机场 / VPS 组选择具体节点。'],
                ['直出时，选择对应节点', 'VPS 直出选择「自建 VPS」里的节点；机场直出选择「前置机场」及其地区。切换出口模式也会改变 AI 专用端口的出口。'],
              ].map(([title, note], index) => <li key={title} className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium text-primary">{index + 1}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{note}</p></div></li>)}
            </ol>
            <p className="mt-5 border-t pt-4 text-xs leading-6 text-muted-foreground">本页展示配置和订阅缓存，不读取本机 Clash 的实时节点、出口或延迟。实际连接请在 Clash 查看并测试。</p>
          </section>
          <div className="space-y-4">
            <section className={`rounded-2xl border p-5 ${failed.length ? 'border-amber-200 bg-amber-50' : 'bg-card'}`}>
              <h2 className="mb-3 flex items-center gap-2 font-semibold">{failed.length ? <TriangleAlert className="size-4 text-amber-700" /> : <Check className="size-4 text-primary" />}{failed.length ? '需要处理' : '订阅更新记录'}</h2>
              {data?.configured ? <ul className="space-y-3">{airports.map(a => <li key={a.id} className="text-sm"><div className="flex flex-wrap justify-between gap-2 font-medium"><span>{a.name}</span><span className={a.refreshError ? 'text-amber-800' : 'text-primary'}>{a.refreshError ? '更新失败 · 保留缓存' : '已缓存'}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{a.nodeCount != null && `${a.nodeCount} 个节点 · `}最近检查 {time(a.refreshedAt)}</p></li>)}</ul> : <p className="text-sm text-muted-foreground">解锁后查看，不会自动替换 IP 或节点。</p>}
              {failed.length > 0 && <p className="mt-3 text-sm leading-6 text-amber-900">先确认机场官网的订阅地址。已有缓存可继续尝试使用，新地址下载成功后才会替换。</p>}
              <div className="mt-4"><NextLink href="/connections">维护机场、VPS 与 Webshare</NextLink></div>
            </section>
            <Link href="/policies" className="group flex items-center justify-between gap-4 rounded-2xl border bg-card p-5 transition-colors hover:bg-muted"><div><h2 className="font-semibold">添加国内直连网站</h2><p className="mt-1 text-sm text-muted-foreground">在统一清单里添加域名和应用规则</p></div><ArrowRight className="size-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" /></Link>
          </div>
        </div>
        <UsageGuide />
      </> : data?.configured && <>
        <div className="mb-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">前置机场</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">维护机场订阅；机场里的地区节点在 Clash 切换。</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => { setData({ ...data, airports: [...data.airports, { id: `airport-${crypto.randomUUID()}`, name: '', url: '' }] }); setDirty(true); }}><Plus className="size-4" />添加机场</Button></div>
            <div className="space-y-3">{data.airports.map((airport, index) => <details key={airport.id} open={!airport.hasUrl || undefined} className="group rounded-xl border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden"><div><span className="text-sm font-medium">{airport.name || '新机场'}</span><p className={`mt-1 text-xs ${airport.refreshError ? 'text-amber-700' : 'text-muted-foreground'}`}>{airport.refreshError ? '更新失败，保留已有节点' : airport.hasUrl ? `${airport.nodeCount ?? '已有'} 个节点 · 最近检查 ${time(airport.refreshedAt)}` : '填写名称和订阅地址后保存'}</p></div><span className="flex items-center gap-1 text-xs text-muted-foreground"><Pencil className="size-3" />编辑<ChevronDown className="size-4 transition-transform group-open:rotate-180" /></span></summary>
              <fieldset disabled={busy} className="space-y-4 border-t p-4">
                <label htmlFor={`airport-name-${airport.id}`} className="block text-sm">机场名称<Input id={`airport-name-${airport.id}`} className="mt-2" value={airport.name} onChange={e => { const airports = [...data.airports]; airports[index] = { ...airport, name: e.target.value }; setData({ ...data, airports }); setDirty(true); }} /></label>
                <label htmlFor={`airport-url-${airport.id}`} className="block text-sm">Clash / Mihomo 订阅地址<Input id={`airport-url-${airport.id}`} className="mt-2" type="password" autoComplete="off" value={airport.url} placeholder={airport.hasUrl ? '已保存；留空保留原地址' : '粘贴机场订阅地址'} onChange={e => { const airports = [...data.airports]; airports[index] = { ...airport, url: e.target.value }; setData({ ...data, airports }); setDirty(true); }} /></label>
                {airport.refreshError && <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">{airport.refreshError} 请在机场官网确认有效订阅，填入新地址后保存。</p>}
                <Button size="sm" aria-label={`删除机场 ${airport.name || index + 1}`} variant="ghost" disabled={data.airports.length <= 1 && !vpsNodes.length} onClick={() => { setData({ ...data, airports: data.airports.filter(a => a.id !== airport.id) }); setDirty(true); }}><Trash2 className="size-4" />移除机场</Button>
              </fieldset>
            </details>)}</div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">节点缓存随订阅下载检查，至少间隔一小时刷新。新地址需成功下载才会替换原配置。</p>
          </section>
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Webshare 固定出口</h2><p className="mb-5 mt-1 text-sm leading-6 text-muted-foreground">更换 IP 后，分别填写官网对应模式的参数。前置地区不会改变最终出口。</p>
            <div className="space-y-3">{(['direct', 'backbone'] as const).map(key => <details key={key} className="group rounded-xl border">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden"><div className="min-w-0"><span className="text-sm font-medium">{key === 'direct' ? 'Direct 端点' : 'Backbone 端点'}</span><p className="mt-1 break-all text-xs text-muted-foreground">{data.webshare[key].type.toUpperCase()} · {data.webshare[key].server}:{data.webshare[key].port}</p></div><span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Pencil className="size-3" />编辑<ChevronDown className="size-4 transition-transform group-open:rotate-180" /></span></summary>
              <fieldset disabled={busy} className="space-y-4 border-t p-4">
                <label htmlFor={`server-${key}`} className="block text-sm">代理地址<Input id={`server-${key}`} className="mt-2" value={data.webshare[key].server} onChange={e => updateEndpoint(key, { server: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-3"><label htmlFor={`type-${key}`} className="text-sm">协议<NativeSelect id={`type-${key}`} className="mt-2 w-full" value={data.webshare[key].type} onChange={e => updateEndpoint(key, { type: e.target.value as Endpoint['type'] })}><NativeSelectOption value="http">HTTP</NativeSelectOption><NativeSelectOption value="socks5">SOCKS5</NativeSelectOption></NativeSelect></label><label htmlFor={`port-${key}`} className="text-sm">端口<Input id={`port-${key}`} className="mt-2" type="number" min={1} max={65535} value={data.webshare[key].port} onChange={e => updateEndpoint(key, { port: Number(e.target.value) })} /></label></div>
                <label htmlFor={`username-${key}`} className="block text-sm">用户名<Input id={`username-${key}`} className="mt-2" autoComplete="off" value={data.webshare[key].username} onChange={e => updateEndpoint(key, { username: e.target.value })} /></label>
                <label htmlFor={`password-${key}`} className="block text-sm">密码<Input id={`password-${key}`} className="mt-2" type="password" autoComplete="new-password" value={data.webshare[key].password} placeholder={data.webshare[key].hasPassword ? '已保存；留空不修改' : '填写密码'} onChange={e => updateEndpoint(key, { password: e.target.value })} /></label>
                <p className="text-xs leading-6 text-muted-foreground">账号、协议和端口按当前官网原样填写，不同连接模式可能不同。</p>
              </fieldset>
            </details>)}</div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">这里只显示已保存的端点，实际出口 IP 和连通性需通过 Clash 发起请求验证。</p>
          </section>
        </div>
        <section className="mb-6 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">自建 VPS</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">安装代理服务后，粘贴 VLESS REALITY 节点链接。可单独出网，也可作为 Webshare 前置。</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => { setData({ ...data, vpsNodes: [...vpsNodes, { id: `vps-${crypto.randomUUID()}`, name: '', shareUrl: '' }] }); setDirty(true); }}><Plus className="size-4" />添加 VPS</Button></div>
          {!vpsNodes.length && <p className="rounded-xl bg-muted/50 p-4 text-sm leading-6 text-muted-foreground">尚未添加代理节点。VPS 的主机 IP 和 SSH 端口不是代理配置；需要先完成服务器部署与验证。网站不接收 SSH / root 密码。</p>}
          <div className="space-y-3">{vpsNodes.map((vps, index) => <details key={vps.id} open={!vps.hasConfig || undefined} className="group rounded-xl border">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden"><div><span className="text-sm font-medium">{vps.name || '新 VPS'}</span><p className="mt-1 text-xs text-muted-foreground">{vps.hasConfig ? `VLESS REALITY · ${vps.server}:${vps.port}` : '填写名称和节点链接后保存'}</p></div><span className="flex items-center gap-1 text-xs text-muted-foreground">编辑<ChevronDown className="size-4 transition-transform group-open:rotate-180" /></span></summary>
            <fieldset disabled={busy} className="space-y-4 border-t p-4">
              <label htmlFor={`vps-name-${vps.id}`} className="block text-sm">VPS 名称<Input id={`vps-name-${vps.id}`} className="mt-2" value={vps.name} placeholder="例如：Legend SG" onChange={e => { const next = [...vpsNodes]; next[index] = { ...vps, name: e.target.value }; setData({ ...data, vpsNodes: next }); setDirty(true); }} /></label>
              <label htmlFor={`vps-link-${vps.id}`} className="block text-sm">VLESS REALITY 节点链接<Input id={`vps-link-${vps.id}`} className="mt-2" type="password" autoComplete="off" value={vps.shareUrl} placeholder={vps.hasConfig ? '已保存；留空保留原节点' : '粘贴 vless:// 节点链接'} onChange={e => { const next = [...vpsNodes]; next[index] = { ...vps, shareUrl: e.target.value }; setData({ ...data, vpsNodes: next }); setDirty(true); }} /></label>
              <Button size="sm" variant="ghost" disabled={vpsNodes.length <= 1 && !data.airports.length} onClick={() => { setData({ ...data, vpsNodes: vpsNodes.filter(v => v.id !== vps.id) }); setDirty(true); }}><Trash2 className="size-4" />移除 VPS</Button>
            </fieldset>
          </details>)}</div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">保存并刷新 Clash 后才会出现新节点。网站保存成功只代表参数已存储，不代表 VPS 已能连通。</p>
        </section>
        <section className="mb-6 grid gap-4 rounded-2xl border bg-card p-5 text-sm sm:grid-cols-2">
          <div><h2 className="font-medium">换机场或换 IP</h2><p className="mt-2 leading-6 text-muted-foreground">展开编辑 → 保存到 NAS → 在 Clash 刷新日常订阅 → 检查出口和实际服务。已有订阅地址无需重新导入。</p></div><div><h2 className="font-medium">只想换地区，或加国内直连？</h2><p className="mt-2 leading-6 text-muted-foreground">出口模式、VPS 和地区节点直接在 Clash 选择。国内网站到分流规则添加，约五分钟获取更新。</p><div className="mt-2"><NextLink href="/policies">管理分流规则</NextLink></div></div>
        </section>
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:px-5">
          <div><p className="text-sm font-medium">{dirty ? '有尚未保存的修改' : '已保存到 NAS'}</p><p className="mt-1 text-xs text-muted-foreground">{dirty ? '保存后还需在 Clash 刷新日常订阅' : `上次保存 ${time(data.updatedAt)} · 不代表 Clash 已应用`}</p></div>
          <div className="flex gap-2">{dirty && <Button variant="ghost" disabled={busy} onClick={() => beginLoad()}>放弃修改</Button>}<Button onClick={() => void save()} disabled={busy || !dirty}><Save className="size-4" />{busy ? '正在保存…' : '保存连接配置'}</Button></div>
        </div>
      </>}
    </div>
  </main>;
}
