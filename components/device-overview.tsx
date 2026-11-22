'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Globe2, Router, Settings2, Wifi } from 'lucide-react';
import { HubNav } from '@/components/hub-nav';

type Site = { id: string; domain: string; action: 'DIRECT' | 'PROXY' };

export function DeviceOverview() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/direct-sites', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('read failed');
        return response.json();
      })
      .then(data => setSites(data.sites))
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  const directSites = sites?.filter(site => site.action === 'DIRECT') || [];
  const proxySites = sites?.filter(site => site.action === 'PROXY') || [];

  return <main className="min-h-screen bg-background text-foreground">
    <HubNav active="overview" />
    <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-7">
      <header className="mb-8">
        <p className="text-xs font-semibold tracking-widest text-primary">个人网络</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">网络管理</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">为设备选择线路，集中维护网站规则与代理配置。</p>
      </header>
      <section className="grid gap-5 lg:grid-cols-[1.35fr_1fr]" aria-label="常用操作">
        <article className="flex flex-col rounded-2xl border border-primary/15 bg-primary p-6 text-primary-foreground sm:p-8">
          <span className="flex items-center gap-2 text-sm text-primary-foreground/75"><Wifi aria-hidden="true" className="size-4" />家庭网络</span>
          <h2 className="mt-4 text-2xl font-semibold">设备连上 Wi-Fi，线路在这里选。</h2>
          <p className="mt-3 max-w-md flex-1 text-sm leading-7 text-primary-foreground/80">新设备默认使用家庭宽带。在「设备上网」中选择新加坡分流，查看网关状态；已接入设备可以随时切回直连。</p>
          <Link href="/home-network" className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg bg-card px-5 py-3 text-sm font-semibold text-primary hover:bg-secondary">管理设备线路<ArrowRight aria-hidden="true" className="size-4" /></Link>
          <p className="mt-3 text-xs text-primary-foreground/70">请从家庭局域网入口打开设备管理。</p>
        </article>
        <article className="rounded-2xl border bg-card p-6 sm:p-8">
          <span className="flex items-center gap-2 text-sm text-muted-foreground"><Globe2 aria-hidden="true" className="size-4" />网站规则</span>
          <h2 className="mt-4 text-xl font-semibold">需要单独处理的网站</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">给指定网站设置直连或代理例外。客户端与网关按各自的规则更新周期读取。</p>
          {error ? <p className="mt-4 text-sm text-amber-800">暂时读不到规则清单。</p> : !sites ? <p className="mt-4 text-sm text-muted-foreground">正在读取规则…</p> : <p className="mt-4 text-sm"><strong>{directSites.length}</strong> 个直连网站<span className="mx-2 text-muted-foreground">·</span><strong>{proxySites.length}</strong> 个代理例外</p>}
          <Link href="/policies" className="mt-6 inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium text-primary hover:bg-secondary">管理网站规则<ArrowRight aria-hidden="true" className="size-4" /></Link>
        </article>
      </section>
      <section className="mt-6 rounded-2xl border bg-card" aria-labelledby="maintenance-title">
        <div className="border-b px-6 py-4"><h2 id="maintenance-title" className="text-sm font-semibold">线路与客户端维护</h2></div>
        <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
          <Link href="/connections" className="flex items-start gap-3 p-6 transition hover:bg-muted/40">
            <Router aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
            <div><h3 className="text-sm font-semibold">线路管理</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">维护 VPS、机场与订阅。已有客户端仍在这里更新配置。</p></div>
            <ArrowRight aria-hidden="true" className="mt-1 ml-auto size-4 shrink-0 text-muted-foreground" />
          </Link>
          <Link href="/claude" className="flex items-start gap-3 p-6 transition hover:bg-muted/40">
            <Settings2 aria-hidden="true" className="mt-1 size-5 shrink-0 text-primary" />
            <div><h3 className="text-sm font-semibold">Claude 专用设置</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">维护独立保存的专用出口与已有客户端配置。</p></div>
            <ArrowRight aria-hidden="true" className="mt-1 ml-auto size-4 shrink-0 text-muted-foreground" />
          </Link>
        </div>
      </section>
      <footer className="mt-6 flex flex-wrap justify-between gap-3 px-1 text-xs leading-6 text-muted-foreground">
        <span>设备线路与客户端订阅分别管理。</span><Link href="/network-guide.html" className="text-primary hover:underline">查看使用帮助 →</Link>
      </footer>
    </div>
  </main>;
}
