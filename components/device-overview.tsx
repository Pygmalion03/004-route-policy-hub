'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Laptop, Monitor, ShieldCheck, Smartphone, Route, Server, Globe2 } from 'lucide-react';
import { HubNav } from '@/components/hub-nav';

type Policy = {
  id: string;
  name: string;
  kind: string;
  action: 'DIRECT' | 'PROXY';
  enabled: boolean;
  matchers: { type: string; value: string }[];
};
type Connections = {
  configured: boolean;
  claude?: { frontName: string; mode: 'vps' | 'webshare'; expectedIp: string } | null;
  airports: { id: string; name: string; enabled: boolean; refreshError?: string }[];
  vpsNodes?: { id: string; name: string; type?: string }[];
};
const devices = [
  { icon: Laptop, name: 'Mac', tag: '本机专用规则', route: '直连清单中的网站直连，其他走代理', dns: '地址查询默认走所选代理', claude: '专用 Edge 或启动器走固定线路', detail: 'UU 远程、荣耀投屏和局域网等保留直连。', accent: 'bg-[#e4f0ea] text-[#155840]' },
  { icon: Smartphone, name: 'iPhone', tag: '手机订阅', route: '直连清单中的网站直连，其他走代理', dns: '地址查询默认走 Claude 固定线路', claude: 'Claude 域名优先走固定线路', detail: '需在 Clash Mi 选择规则模式并保持连接。', accent: 'bg-[#f8ede0] text-[#8b522d]' },
  { icon: Monitor, name: 'Windows', tag: '电脑订阅', route: '按国内域名和 IP 清单决定直连或代理', dns: '直连和国内域名用国内 DNS', claude: '普通应用的专用保护尚未验收', detail: '域名或 IP 在国内清单中则直连，都不在则走代理。', accent: 'bg-[#e8eef7] text-[#365b84]' },
];

function uniqueDomains(policies: Policy[], action: 'DIRECT' | 'PROXY') {
  return [...new Set(policies.filter(p => p.enabled && p.action === action).flatMap(p => p.matchers.filter(m => m.type === 'DOMAIN-SUFFIX').map(m => m.value)))];
}

export function DeviceOverview() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [policyError, setPolicyError] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/policies', { cache: 'no-store' }).then(async r => {
      if (!r.ok) throw new Error('read failed');
      return r.json();
    }).then(data => { if (active) setPolicies(data.policies); }).catch(() => { if (active) setPolicyError(true); });
    const password = sessionStorage.getItem('route-list-password');
    if (password) fetch('/api/connections', { headers: { 'x-admin-password': password }, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(data => { if (active && data?.configured) setConnections(data); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const direct = policies ? uniqueDomains(policies, 'DIRECT') : [];
  const proxied = policies ? uniqueDomains(policies, 'PROXY') : [];
  const paused = connections?.airports.filter(a => a.enabled === false) || [];
  const failed = connections?.airports.filter(a => a.enabled !== false && a.refreshError) || [];
  return (
    <main className="min-h-screen bg-[#f6f7f3] text-[#182b23]">
      <HubNav active="overview" />
      <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-10 sm:px-7 sm:pt-14">
        <header className="grid gap-8 border-b border-[#d9e3da] pb-9 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[#4b7763]"><span className="size-2 rounded-full bg-[#6fa984]" />个人网络管理</p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">每台设备，<br className="sm:hidden" />一眼看清。</h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-7 text-[#5b6d62]">查看 Mac、iPhone 和 Windows 的分流规则，管理需要直连的网站，以及已配置的线路。</p>
          </div>
          <div className="max-w-[280px] border-l-2 border-[#b4caba] pl-4 text-xs leading-6 text-[#64756a]">这里显示网站下发的配置。设备当前是否连接、选中了哪个节点，请在设备的 Clash 中确认。</div>
        </header>

        <section className="mt-9" aria-labelledby="device-title">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-widest text-[#63816e]">01 / 设备规则</p><h2 id="device-title" className="mt-2 text-2xl font-semibold tracking-tight">你的设备怎么走</h2></div><Link href="/network-guide.html" className="inline-flex items-center gap-1 text-sm font-medium text-[#23654b] hover:underline">查看使用说明 <ArrowUpRight className="size-4" /></Link></div>
          <div className="grid gap-4 md:grid-cols-3">
            {devices.map(({ icon: Icon, ...d }) => <article key={d.name} className="flex flex-col rounded-[22px] border border-[#dfe8df] bg-white p-5 shadow-[0_8px_30px_rgba(30,66,45,0.035)] sm:p-6">
              <div className="flex items-start justify-between gap-3"><span className={`grid size-11 place-items-center rounded-2xl ${d.accent}`}><Icon className="size-5" /></span><span className="rounded-full bg-[#f1f4ef] px-3 py-1 text-[11px] font-medium text-[#69796e]">{d.tag}</span></div>
              <h3 className="mt-6 text-xl font-semibold">{d.name}</h3>
              <dl className="mt-5 flex-1 space-y-4 text-sm"><div><dt className="text-xs text-[#829084]">普通网站</dt><dd className="mt-1 font-medium leading-6">{d.route}</dd></div><div><dt className="text-xs text-[#829084]">Claude</dt><dd className="mt-1 leading-6">{d.claude}</dd></div><div><dt className="text-xs text-[#829084]">DNS / 网址查询</dt><dd className="mt-1 leading-6">{d.dns}</dd></div></dl>
              <p className="mt-5 border-t border-[#eef1ec] pt-4 text-xs leading-6 text-[#718075]">{d.detail}</p>
            </article>)}
          </div>
          <p className="mt-4 text-xs leading-6 text-[#738178]">其他设备是否相同，取决于它导入的是哪份订阅及本机覆写；网站无法确认。</p>
        </section>

        <section className="mt-12 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]" aria-label="当前网站规则和线路">
          <div className="rounded-[22px] border border-[#dfe8df] bg-white p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-widest text-[#63816e]">02 / 网站规则</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">哪些网站有明确规则</h2></div><Link href="/policies" className="inline-flex items-center gap-1 text-sm font-medium text-[#23654b] hover:underline">管理例外 <ArrowUpRight className="size-4" /></Link></div>
            {policyError ? <p className="mt-6 text-sm text-amber-800">暂时读不到网站规则，请刷新页面。</p> : !policies ? <p className="mt-6 text-sm text-[#718075]">正在读取网站规则…</p> : <div className="mt-6 space-y-5">
              <div className="flex gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#e8f4e9] text-[#397b50]"><ArrowDownLeft className="size-4" /></span><div className="min-w-0"><h3 className="text-sm font-semibold">直接连接</h3><p className="mt-1 break-words text-sm leading-7 text-[#607167]">{direct.length ? direct.join('、') : '暂无域名例外'}；管理网站和局域网地址也直连。</p></div></div>
              <div className="flex gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#e9eff8] text-[#41668f]"><ArrowUpRight className="size-4" /></span><div className="min-w-0"><h3 className="text-sm font-semibold">明确走所选代理</h3><p className="mt-1 break-words text-sm leading-7 text-[#607167]">{proxied.length ? proxied.join('、') : '暂无域名规则'}</p></div></div>
              <p className="rounded-xl bg-[#f5f7f3] px-4 py-3 text-xs leading-6 text-[#6a796d]">域名规则也匹配子域名。一个网站可能使用多个域名，例如 B 站视频与图片不一定属于 bilibili.com。</p>
            </div>}
          </div>
          <div className="flex flex-col rounded-[22px] bg-[#103d2e] p-6 text-white sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-widest text-[#a7c7b5]">03 / 线路配置</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">出口与节点</h2></div><span className="grid size-10 place-items-center rounded-full bg-white/10"><Route className="size-5" /></span></div>
            {connections ? <div className="mt-6 space-y-4 text-sm leading-6"><div><p className="text-xs text-[#a9c6b3]">Claude 固定线路</p><p className="mt-1 font-medium">{connections.claude ? `${connections.claude.frontName}${connections.claude.mode === 'webshare' ? ' → Webshare' : ' · VPS 直出'}` : '尚未配置'}</p></div><div><p className="text-xs text-[#a9c6b3]">已配置 VPS</p><p className="mt-1">{connections.vpsNodes?.map(n => n.name).join('、') || '暂无'}</p></div><div><p className="text-xs text-[#a9c6b3]">机场</p><p className="mt-1">{connections.airports.map(a => `${a.name}${a.enabled === false ? '（已停用）' : a.refreshError ? '（更新失败）' : ''}`).join('、') || '暂无'}</p></div>{(paused.length > 0 || failed.length > 0) && <p className="rounded-xl bg-white/10 p-3 text-xs leading-6 text-[#d9e9de]">{paused.length > 0 ? '已停用的机场保留订阅资料，不向设备下发节点。' : '机场更新失败时可能继续下发缓存节点，可在线路管理中处理。'}</p>}</div> : <p className="mt-6 flex-1 text-sm leading-7 text-[#c5dbcb]">在线路管理中解锁后，这里会显示已配置的节点和机场状态。不会读取设备当前的节点选择。</p>}
            <Link href="/connections" className="mt-7 inline-flex w-fit items-center gap-2 rounded-full bg-[#e3f1df] px-4 py-2.5 text-sm font-semibold text-[#173f2d] hover:bg-white">管理线路 <ArrowRight className="size-4" /></Link>
          </div>
        </section>
        <section className="mt-6 grid gap-3 rounded-[22px] border border-[#e2e9df] bg-[#edf3ea] p-5 text-sm leading-6 text-[#50655a] sm:grid-cols-2 sm:p-6"><p className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#347052]" /><span>Claude 的固定配置独立保存。切换普通网站的节点，不会自动改变它。</span></p><p className="flex gap-3"><Server className="mt-0.5 size-5 shrink-0 text-[#347052]" /><span>修改线路后需刷新设备订阅；添加网站例外后由规则集更新。<Link href="/claude" className="ml-1 font-medium text-[#23654b] underline underline-offset-4">Claude 设置</Link></span></p></section>
        <footer className="mt-10 flex items-center gap-2 text-xs text-[#8b998e]"><Globe2 className="size-4" />网络规则由你的网站管理 · 设备状态以 Clash 为准</footer>
      </div>
    </main>
  );
}
