'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, LockKeyhole } from 'lucide-react';
import { HubNav } from '@/components/hub-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type View = { updatedAt: string; uuDirect: boolean; sites: { id: string; domain: string }[] };
export function DirectSiteConsole() {
  const [data, setData] = useState<View | null>(null),
    [domain, setDomain] = useState('');
  const [password, setPassword] = useState(''),
    [unlocked, setUnlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function load() {
    try {
      const r = await fetch('/api/direct-sites', { cache: 'no-store' });
      if (!r.ok) throw new Error('读取失败');
      setData(await r.json());
    } catch {
      setMessage('读取清单失败，请刷新页面。');
    }
  }
  useEffect(() => {
    fetch('/api/direct-sites', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('读取失败');
        const result = await r.json();
        setData(result);
        setUnlocked(Boolean(sessionStorage.getItem('route-list-password')));
      })
      .catch(() => setMessage('读取失败，请刷新页面。'));
  }, []);
  async function unlock() {
    const r = await fetch('/api/connections', {
      headers: { 'x-admin-password': password },
    });
    if (!r.ok) {
      setMessage('管理密码不正确');
      return;
    }
    sessionStorage.setItem('route-list-password', password);
    setPassword('');
    setUnlocked(true);
    setMessage('已解锁');
  }
  async function update(id?: string, application?: 'uu-remote') {
    if (!data) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/direct-sites', {
        method: id ? 'DELETE' : 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-password':
            sessionStorage.getItem('route-list-password') || '',
        },
        body: JSON.stringify({
          updatedAt: data.updatedAt,
          ...(id ? { id } : application ? { application } : { domain }),
        }),
      });
      const result = await r.json();
      if (!r.ok) {
        if (r.status === 409) await load();
        throw new Error(result.error);
      }
      setData(result);
      setDomain('');
      setMessage(
        application
          ? 'UU 远程已设为直连，约五分钟更新。Claude 专用入口继续使用固定代理。'
          : id
          ? '已移除。该网站恢复跟随日常方案，约五分钟更新。'
          : '已添加。该网站及其子域名会直连，约五分钟更新。',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-background text-foreground">
      <HubNav active="policies" />
      <div className="mx-auto max-w-[1000px] px-5 py-9 sm:px-7">
        <p className="text-xs tracking-widest text-primary">只管理例外</p>
        <h1 className="mt-2 text-3xl font-semibold">国内直连清单</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          日常网站默认走你在 Clash
          选择的方案。只有加入这里的网站才直连；移除后恢复默认。
        </p>
        <div className="my-6 rounded-2xl border border-primary/20 bg-secondary/40 p-5 text-sm leading-7">
          <strong>这份清单不影响 Claude 专用入口。</strong>
          <p>
            Claude
            专用网络独立使用固定出口，不会因为这里添加了网站而直连。局域网与
            Tailscale 的基础直连规则单独保留。
          </p>
        </div>
        {!unlocked ? (
          <section className="mb-6 rounded-2xl border bg-card p-5">
            <label htmlFor="direct-password" className="text-sm">
              管理密码
              <Input
                id="direct-password"
                type="password"
                autoComplete="current-password"
                className="mt-2"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void unlock();
                }}
              />
            </label>
            <Button className="mt-3" onClick={() => void unlock()}>
              <LockKeyhole className="size-4" />
              解锁编辑
            </Button>
          </section>
        ) : (
          <section className="mb-6 rounded-2xl border bg-card p-5">
            <label htmlFor="direct-domain" className="text-sm font-medium">
              添加需要直连的网站
            </label>
            <div className="mt-3 flex flex-wrap gap-3">
              <Input
                id="direct-domain"
                className="min-w-48 flex-1"
                placeholder="例如 bilibili.com，也可以粘贴网站地址"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && domain.trim() && !busy)
                    void update();
                }}
              />
              <Button
                disabled={busy || !domain.trim()}
                onClick={() => void update()}
              >
                <Plus className="size-4" />
                添加并保存
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              不需要选择直连或代理，也没有启用开关。
            </p>
          </section>
        )}
        <section className="mb-6 rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">UU 远程</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            按应用进程直连，减少代理流量消耗。此例外不影响 Claude 专用入口。
          </p>
          <Button className="mt-3" variant="outline"
            disabled={!data || !unlocked || busy || data.uuDirect}
            onClick={() => void update(undefined, 'uu-remote')}>
            {data?.uuDirect ? '已启用直连' : '启用 UU 远程直连'}
          </Button>
        </section>
        {message && (
          <output
            className="mb-5 block rounded-xl border bg-card p-4 text-sm"
            aria-live="polite"
          >
            {message}
          </output>
        )}
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">
            已添加的网站{' '}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {data?.sites.length ?? '…'} 个
            </span>
          </h2>
          {data?.sites.length ? (
            <ul className="mt-4 divide-y">
              {data.sites.map((site) => (
                <li
                  key={site.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-medium">{site.domain}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      包含其子域名 · 直连
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!unlocked || busy}
                    onClick={() => void update(site.id)}
                    aria-label={`移除 ${site.domain}`}
                  >
                    <Trash2 className="size-4" />
                    移除
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              {data
                ? '还没有添加网站。日常外网流量默认使用代理方案。'
                : '正在读取…'}
            </p>
          )}
        </section>
        <p className="mt-5 text-xs leading-6 text-muted-foreground">
          修改会自动保存到 NAS，Clash
          约五分钟获取规则。连接参数的更换仍需刷新订阅。
        </p>
      </div>
    </main>
  );
}
