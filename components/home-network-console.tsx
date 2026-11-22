'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, LockKeyhole, ShieldCheck, Wifi } from 'lucide-react';
import { HubNav } from '@/components/hub-nav';
import { HomePolicyPanel } from '@/components/home-policy-panel';
import { LanDevicePanel } from '@/components/lan-device-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PolicyStore } from '@/lib/policies';

type View = { policy: PolicyStore; nodes: { id: string; name: string; type: string }[] };
async function readView(password: string, signal?: AbortSignal): Promise<View> {
  const response = await fetch('/api/home-network', { headers: { 'x-admin-password': password }, cache: 'no-store', signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '暂时无法读取设备管理');
  return result;
}

export function HomeNetworkConsole() {
  const [view, setView] = useState<View | null>(null);
  const [policy, setPolicy] = useState<PolicyStore | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [message, setMessage] = useState('');

  async function unlock() {
    setBusy(true); setMessage('');
    try {
      const result = await readView(password);
      sessionStorage.setItem('route-list-password', password);
      setPassword(''); setView(result); setPolicy(result.policy);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解锁失败');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    const supplied = sessionStorage.getItem('route-list-password');
    const controller = new AbortController();
    if (supplied) {
      void readView(supplied, controller.signal).then(result => {
        setView(result); setPolicy(result.policy);
      }).catch(error => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '读取失败');
      }).finally(() => { if (!controller.signal.aborted) setRestoring(false); });
    } else {
      const timer = window.setTimeout(() => setRestoring(false), 0);
      return () => { controller.abort(); window.clearTimeout(timer); };
    }
    return () => controller.abort();
  }, []);

  return <main className="min-h-screen bg-background text-foreground">
    <HubNav active="home-network" />
    <div className="mx-auto max-w-[1180px] space-y-5 px-5 py-6 sm:space-y-6 sm:px-7 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary">家庭网络</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">设备上网</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">新设备默认家庭宽带直连。<span className="hidden sm:inline">需要分流时，在这里找到设备、选择线路即可。</span></p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border bg-card sm:inline-flex px-3 py-1.5 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3.5" />家庭网络内管理</span>
      </header>
      {!view || !policy ? <section className="max-w-lg rounded-2xl border bg-card p-6 sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-secondary text-primary"><LockKeyhole aria-hidden="true" className="size-5" /></span>
        <h2 className="mt-4 text-xl font-semibold">解锁设备管理</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">使用现有管理密码，查看设备并切换上网线路。</p>
        {restoring ? <output className="mt-5 block text-sm text-muted-foreground">正在恢复本次会话…</output> : <form className="mt-5" onSubmit={event => { event.preventDefault(); void unlock(); }}>
          <label htmlFor="home-password" className="text-sm font-medium">管理密码</label>
          <Input id="home-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-11" />
          <Button type="submit" className="mt-4 h-11 w-full" disabled={busy || !password}>{busy ? '正在解锁…' : '解锁设备管理'}</Button>
        </form>}
        {message && <p role="alert" className="mt-4 text-sm text-destructive">{message}</p>}
      </section> : <>
        <div className="flex items-start gap-3 rounded-xl border border-primary/10 bg-secondary/45 px-4 py-3 text-sm leading-6">
          <Wifi aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-muted-foreground"><span className="font-medium text-foreground">连接专用 Wi-Fi，再选择线路。</span> 首次接入如仍走原宽带，重连一次 Wi-Fi 即可。</p>
        </div>
        <LanDevicePanel />
        <details className="group rounded-xl border bg-card px-5 py-4 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
            <span>客户端订阅与规则<span className="ml-2 text-xs font-normal text-muted-foreground">已有 Clash 客户端使用</span></span>
            <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition group-open:rotate-180" />
          </summary>
          <div className="mt-5 space-y-6 border-t pt-5"><HomePolicyPanel store={policy} setStore={setPolicy} nodes={view.nodes} /></div>
        </details>
        <p className="px-1 text-xs leading-6 text-muted-foreground">新设备目前支持新加坡分流与家庭宽带直连；洛杉矶固定出口仅向已支持的设备开放。</p>
      </>}
    </div>
  </main>;
}
