'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, KeyRound, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { Endpoint } from '@/lib/connections';

type View = {
  configured: boolean; updatedAt: string;
  webshare: { direct: Endpoint & { hasPassword?: boolean }; backbone: Endpoint & { hasPassword?: boolean } };
  airports: { id: string; name: string; url: string; hasUrl?: boolean }[];
};
export function ConnectionConsole() {
  const [password, setPassword] = useState('');
  const [data, setData] = useState<View | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const headers = () => ({ 'x-admin-password': password || sessionStorage.getItem('route-list-password') || '', 'content-type': 'application/json' });
  async function load() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/connections', { headers: headers(), cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      sessionStorage.setItem('route-list-password', headers()['x-admin-password']);
      setData(next); setDirty(false);
      if (!next.configured) setMessage('尚未导入连接配置。请先从本机导入已验证的配置。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '读取失败'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/connections', { method: 'PUT', headers: headers(), body: JSON.stringify(data) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setData(next); setDirty(false); setMessage('已保存。请在 Clash 中更新「日常」配置；国内直连名单也会每 5 分钟自动更新。');
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
      setMessage('已复制专用配置地址。首次在 Clash 订阅页粘贴导入，之后更新这一份配置即可。这个地址包含访问凭据，请勿分享。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '复制失败'); }
    finally { setBusy(false); }
  }
  function updateEndpoint(key: 'direct' | 'backbone', patch: Partial<Endpoint>) {
    if (!data) return;
    setData({ ...data, webshare: { ...data.webshare, [key]: { ...data.webshare[key], ...patch } } }); setDirty(true);
  }
  return <main className="min-h-screen bg-background text-foreground">
    <div className="mx-auto max-w-[980px] px-5 py-8 sm:px-8">
      <Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />国内直连与分流清单</Link>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold tracking-tight">连接配置</h1><p className="mt-2 text-sm text-muted-foreground">机场负责连接，Webshare 保持固定出口。在这里维护参数，在 Clash 里选节点。</p></div>
        {data?.configured && <Button onClick={() => void copySubscription()} disabled={busy || dirty} variant="outline"><Copy className="size-4" />复制 Clash 配置地址</Button>}
      </header>
      <section className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-5">
        <label htmlFor="connection-password" className="min-w-52 flex-1 text-sm">管理密码<Input id="connection-password" className="mt-2" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="已在分流清单解锁可留空" onKeyDown={e => { if (e.key === 'Enter') void load(); }} /></label>
        <Button onClick={() => void load()} disabled={busy}><KeyRound className="size-4" />{data ? '重新读取' : '解锁配置'}</Button>
      </section>
      {message && <output className="mb-6 rounded-xl border bg-card px-4 py-3 text-sm leading-6">{message}</output>}
      {data?.configured && <>
        <section className="mb-6 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">前置机场</h2><p className="mt-1 text-sm text-muted-foreground">换订阅时粘贴新地址；留空保留原地址。新地址需使用 Clash / Mihomo 格式。</p></div><Button variant="outline" onClick={() => { setData({ ...data, airports: [...data.airports, { id: `airport-${crypto.randomUUID()}`, name: '', url: '' }] }); setDirty(true); }}><Plus className="size-4" />添加机场</Button></div>
          <div className="space-y-4">{data.airports.map((airport, index) => <div key={airport.id} className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-[180px_1fr_auto]">
            <label htmlFor={`airport-name-${airport.id}`} className="text-sm">机场名称<Input id={`airport-name-${airport.id}`} className="mt-2" value={airport.name} onChange={e => { const airports = [...data.airports]; airports[index] = { ...airport, name: e.target.value }; setData({ ...data, airports }); setDirty(true); }} /></label>
            <label htmlFor={`airport-url-${airport.id}`} className="text-sm">订阅地址<Input id={`airport-url-${airport.id}`} className="mt-2" type="password" autoComplete="off" value={airport.url} placeholder={airport.hasUrl ? '已保存；填写新地址可更换' : '粘贴 Clash 订阅地址'} onChange={e => { const airports = [...data.airports]; airports[index] = { ...airport, url: e.target.value }; setData({ ...data, airports }); setDirty(true); }} /></label>
            <Button className="self-end" aria-label={`删除机场 ${airport.name || index + 1}`} variant="ghost" disabled={data.airports.length <= 1} onClick={() => { setData({ ...data, airports: data.airports.filter(a => a.id !== airport.id) }); setDirty(true); }}><Trash2 className="size-4" /></Button>
          </div>)}</div>
        </section>
        <section className="mb-6 rounded-2xl border bg-card p-5 sm:p-6"><h2 className="text-lg font-semibold">Webshare 固定出口</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">换 IP 后，把官网对应模式的参数填写到这里。账号和端口按官网原样填写，密码留空保留原值。</p>
          <div className="space-y-6">{(['direct', 'backbone'] as const).map(key => <fieldset key={key} className="rounded-xl border p-4"><legend className="px-2 text-sm font-medium">{key === 'direct' ? 'Direct 直连端点' : 'Backbone 中转端点'}</legend><div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor={`server-${key}`} className="text-sm">代理地址<Input id={`server-${key}`} className="mt-2" value={data.webshare[key].server} onChange={e => updateEndpoint(key, { server: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3"><label htmlFor={`type-${key}`} className="text-sm">协议<NativeSelect id={`type-${key}`} className="mt-2 w-full" value={data.webshare[key].type} onChange={e => updateEndpoint(key, { type: e.target.value as Endpoint['type'] })}><NativeSelectOption value="http">HTTP</NativeSelectOption><NativeSelectOption value="socks5">SOCKS5</NativeSelectOption></NativeSelect></label><label htmlFor={`port-${key}`} className="text-sm">端口<Input id={`port-${key}`} className="mt-2" type="number" min={1} max={65535} value={data.webshare[key].port} onChange={e => updateEndpoint(key, { port: Number(e.target.value) })} /></label></div>
            <label htmlFor={`username-${key}`} className="text-sm">用户名<Input id={`username-${key}`} className="mt-2" autoComplete="off" value={data.webshare[key].username} onChange={e => updateEndpoint(key, { username: e.target.value })} /></label>
            <label htmlFor={`password-${key}`} className="text-sm">密码<Input id={`password-${key}`} className="mt-2" type="password" autoComplete="new-password" value={data.webshare[key].password} placeholder={data.webshare[key].hasPassword ? '已保存；留空不修改' : '填写密码'} onChange={e => updateEndpoint(key, { password: e.target.value })} /></label>
          </div></fieldset>)}</div>
        </section>
        <div className="mb-6 flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">{dirty ? '有尚未保存的修改' : `已保存 · ${new Date(data.updatedAt).toLocaleString('zh-CN')}`}</p><Button onClick={() => void save()} disabled={busy || !dirty}><Save className="size-4" />{busy ? '正在保存…' : '保存连接配置'}</Button></div>
        <section className="rounded-2xl bg-primary/5 p-5 text-sm leading-7"><h2 className="font-semibold">平时怎么用</h2><ol className="mt-2 list-inside list-decimal"><li>Clash 激活「日常」配置。</li><li>在「前置机场」选机场，再在对应的节点组里选地区。</li><li>切换前置节点仍使用同一个 Webshare 出口；连接失败时会报错。</li><li>网站改好机场或 Webshare 参数后，在 Clash 更新配置。</li></ol><p className="mt-3"><Link href="/" className="underline underline-offset-4">添加国内直连域名 →</Link></p></section>
      </>}
    </div>
  </main>;
}
