'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Laptop, Monitor, Smartphone } from 'lucide-react';
import { HubNav } from '@/components/hub-nav';

type Site = { id: string; domain: string; action: 'DIRECT' | 'PROXY' };

export function DeviceOverview() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/direct-sites', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('read failed');
        return response.json();
      })
      .then((data) => { if (active) setSites(data.sites); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  const directSites = sites?.filter((site) => site.action === 'DIRECT') || [];
  const proxySites = sites?.filter((site) => site.action === 'PROXY') || [];

  return (
    <main className="min-h-screen bg-[#f6f7f3] text-[#182b23]">
      <HubNav active="overview" />
      <div className="mx-auto max-w-[1080px] px-5 pb-20 pt-10 sm:px-7 sm:pt-14">
        <header className="border-b border-[#d9e3da] pb-9">
          <p className="mb-4 text-xs font-semibold tracking-widest text-[#4b7763]">个人网络管理</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">让网站按你的方式连接。</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[#5b6d62]">在这里添加需要直连的网站，一次设置，Mac、iPhone 和 Windows 共用。</p>
        </header>

        <section className="mt-9 grid gap-5 lg:grid-cols-[1.3fr_0.7fr]" aria-label="网站连接方式">
          <div className="rounded-[22px] border border-[#dfe8df] bg-white p-6 shadow-[0_8px_30px_rgba(30,66,45,0.035)] sm:p-8">
            <p className="text-xs font-semibold tracking-widest text-[#63816e]">你添加的网站</p>
            <h2 className="mt-2 text-2xl font-semibold">直连网站</h2>
            {error ? <p className="mt-5 text-sm text-amber-800">暂时读不到清单，请刷新页面。</p> : !sites ? <p className="mt-5 text-sm text-[#718075]">正在读取…</p> : directSites.length ? (
              <div className="mt-5 flex flex-wrap gap-2">{directSites.map(site => <span key={site.id} className="rounded-full bg-[#edf5ed] px-4 py-2 text-sm font-medium text-[#245d3d]">{site.domain}</span>)}</div>
            ) : <p className="mt-5 text-sm text-[#718075]">还没有添加直连网站。</p>}
            <p className="mt-5 text-sm leading-6 text-[#607167]">清单中的地址及其子域名会直连；一个网站的视频或图片可能使用其他地址。</p>
            <Link href="/policies" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#185b3d] px-5 py-3 text-sm font-semibold text-white hover:bg-[#10492f]">添加或更改网站 <ArrowRight className="size-4" /></Link>
            {proxySites.length > 0 && <p className="mt-5 border-t border-[#eef1ec] pt-4 text-xs leading-6 text-[#718075]">你另外指定走代理的网站：{proxySites.map(site => site.domain).join('、')}</p>}
          </div>
          <div className="flex flex-col rounded-[22px] bg-[#103d2e] p-6 text-white sm:p-8">
            <p className="text-xs font-semibold tracking-widest text-[#a7c7b5]">需要更换节点时</p>
            <h2 className="mt-2 text-2xl font-semibold">线路管理</h2>
            <p className="mt-5 flex-1 text-sm leading-7 text-[#d3e5d8]">管理 VPS、机场和订阅。修改线路后，在设备的 Clash 中刷新订阅。</p>
            <Link href="/connections" className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-[#e3f1df] px-5 py-3 text-sm font-semibold text-[#173f2d] hover:bg-white">管理线路 <ArrowRight className="size-4" /></Link>
          </div>
        </section>

        <section className="mt-12" aria-labelledby="devices-title">
          <h2 id="devices-title" className="text-2xl font-semibold tracking-tight">三台设备怎么上网</h2>
          <p className="mt-2 text-sm leading-6 text-[#607167]">三台设备共用上面的直连清单，其他网站这样处理：</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              { icon: Laptop, name: 'Mac', text: '其他网站走所选代理。Claude 请用专用 Edge 或项目启动器。', accent: 'bg-[#e4f0ea] text-[#155840]' },
              { icon: Smartphone, name: 'iPhone', text: '其他网站走所选代理。Clash Mi 连接时，Claude 使用固定线路。', accent: 'bg-[#f8ede0] text-[#8b522d]' },
              { icon: Monitor, name: 'Windows', text: '按国内网站清单和地址判断：符合直连规则就直连，其他走所选代理。', accent: 'bg-[#e8eef7] text-[#365b84]' },
            ].map(({ icon: Icon, name, text, accent }) => <article key={name} className="rounded-[22px] border border-[#dfe8df] bg-white p-6">
              <span className={`grid size-11 place-items-center rounded-2xl ${accent}`}><Icon className="size-5" /></span>
              <h3 className="mt-5 text-lg font-semibold">{name}</h3>
              <p className="mt-3 text-sm leading-7 text-[#607167]">{text}</p>
            </article>)}
          </div>
          <p className="mt-4 text-xs leading-6 text-[#738178]">网站显示已配置的规则；设备是否已更新、目前选择了哪条线路，请在设备的 Clash 中查看。部分应用和局域网另有直连规则。</p>
        </section>
        <footer className="mt-10 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#4d6e5b]"><Link href="/claude" className="hover:underline">Claude 设置</Link><Link href="/network-guide.html" className="hover:underline">使用说明</Link></footer>
      </div>
    </main>
  );
}
