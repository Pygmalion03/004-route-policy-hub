'use client';

import { useEffect, useState } from 'react';
import { Copy, LockKeyhole, ShieldCheck, RefreshCw } from 'lucide-react';
import { HubNav, NextLink } from '@/components/hub-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

type View = {
  configured: boolean;
  updatedAt: string;
  claude: {
    mode: 'vps' | 'webshare';
    expectedIp: string;
    frontName: string;
    pinnedAt: string;
    port: number;
  } | null;
  vpsNodes?: { id: string; name: string }[];
  webshare: { direct: { server: string } };
};
export function ClaudeConsole() {
  const [data, setData] = useState<View | null>(null),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState('');
  const [vpsId, setVpsId] = useState(''),
    [mode, setMode] = useState<'vps' | 'webshare'>('vps'),
    [expectedIp, setExpectedIp] = useState(''),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  async function load(supplied?: string) {
    setBusy(true);
    setMessage('');
    try {
      const auth =
        supplied || sessionStorage.getItem('route-list-password') || '';
      const r = await fetch('/api/connections', {
        headers: { 'x-admin-password': auth },
        cache: 'no-store',
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      sessionStorage.setItem('route-list-password', auth);
      setPassword('');
      setData(result);
      setVpsId(result.vpsNodes?.[0]?.id || '');
      setMode(result.claude?.mode || 'vps');
      setExpectedIp(
        result.claude?.expectedIp || result.webshare?.direct?.server || '',
      );
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
    fetch('/api/connections', {
      headers: { 'x-admin-password': auth },
      cache: 'no-store',
    })
      .then(async (r) => {
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        if (active) {
          setData(result);
          setVpsId(result.vpsNodes?.[0]?.id || '');
          setMode(result.claude?.mode || 'vps');
          setExpectedIp(
            result.claude?.expectedIp || result.webshare?.direct?.server || '',
          );
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function pin() {
    if (!data) return;
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/connections', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-admin-password':
            sessionStorage.getItem('route-list-password') || '',
        },
        body: JSON.stringify({ ...data, pinClaude: { vpsId, expectedIp, mode } }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setData(result);
      setEditing(false);
      setMessage(
        'Claude 专用配置已发布。请刷新 Clash 的日常订阅，再通过本机安全启动器检查并启动。网站没有验证本机保护状态。',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '发布失败');
    } finally {
      setBusy(false);
    }
  }
  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage('启动命令已复制，请在本机 Terminal 执行。');
    } catch {
      setMessage('复制失败，请使用本机项目 scripts 目录内的启动器。');
    }
  }
  return (
    <main className="min-h-screen bg-background text-foreground">
      <HubNav active="overview" />
      <div className="mx-auto max-w-[1000px] px-5 py-9 sm:px-7">
        <p className="text-xs tracking-widest text-primary">与日常上网分开</p>
        <h1 className="mt-2 text-3xl font-semibold">Claude 专用网络</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          固定出口单独保存。日常切换机场、VPS
          或修改国内直连清单，不改变这里的出口。
        </p>
        {!data ? (
          <section className="my-6 rounded-2xl border bg-card p-5">
            <label htmlFor="claude-password" className="text-sm">
              管理密码
              <Input
                id="claude-password"
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
            <Button
              className="mt-3"
              disabled={busy}
              onClick={() => void load(password)}
            >
              <LockKeyhole className="size-4" />
              解锁配置
            </Button>
          </section>
        ) : (
          <>
            <section className="my-6 rounded-2xl border border-primary/25 bg-primary p-6 text-primary-foreground">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4" />
                  固定出口配置
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  <RefreshCw className="size-3.5" />
                  重新读取
                </Button>
              </div>
              <p className="mt-5 text-3xl font-semibold">
                {data.claude?.expectedIp || '尚未配置'}
              </p>
              <p className="mt-3 text-sm opacity-80">
                {data.claude
                  ? `本机 → ${data.claude.frontName}${data.claude.mode === 'webshare' ? ' → Webshare' : '（VPS 固定直出）'}`
                  : '选择一台已部署 VPS，设置独立固定出口。'}
              </p>
              <p className="mt-4 text-xs leading-6 opacity-80">
                专用端口 17997 · 不自动切换其他出口 · 不使用国内直连清单
              </p>
            </section>
            <section className="mb-6 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">使用 Claude Code 专用启动器</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                启动器先核对实际出口
                IP，再限制 Claude Code 及其子进程只能连接专用代理。专用端口不可用或 IP
                不符时停止启动。普通方式打开的程序不在这层限制内。
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    void copy(
                      '~/Documents/Codex/Projects/004-route-policy-hub/scripts/claude-safe.command',
                    )
                  }
                >
                  <Copy className="size-4" />
                  复制 Claude Code 启动命令
                </Button>
                <Button variant="outline" onClick={() => void copy('~/Documents/Codex/Projects/004-route-policy-hub/scripts/claude-browser.command')}>
                  <Copy className="size-4" />
                  复制专用 Edge 启动命令
                </Button>
              </div>
            </section>
            <section className="mb-6 grid gap-4 rounded-2xl border bg-card p-5 sm:grid-cols-3">
              <div>
                <h2 className="text-sm font-medium">网站配置</h2>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {data.claude
                    ? '已发布，等待客户端刷新确认'
                    : '尚未发布专用配置'}
                </p>
              </div>
              <div>
                <h2 className="text-sm font-medium">本机出口与限制</h2>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  命令行使用网络限制；Edge 启动器核对 LuLu 扩展与规则，未就绪时拒绝打开。网站无法读取本机实时保护状态。
                </p>
              </div>
              <div>
                <h2 className="text-sm font-medium">账号登录与生成</h2>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  需要本人登录验收，不以接口 401 或 IP 分数代替
                </p>
              </div>
            </section>
            <section className="mb-6 rounded-2xl border bg-card p-5">
              <h2 className="font-semibold">仅在确实要更换固定出口时更新</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                专用配置保留所选路线参数的独立副本。日常网络中的参数变更不会同步覆盖；确认新 IP
                后，在这里重新发布。
              </p>
              {!editing ? (
                <Button
                  className="mt-4"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  {data.claude
                    ? '更新 Claude 固定出口'
                    : '设置 Claude 固定出口'}
                </Button>
              ) : (
                <fieldset disabled={busy} className="mt-5 space-y-4">
                  <label htmlFor="claude-mode" className="block text-sm">
                    专用路线
                    <NativeSelect id="claude-mode" className="mt-2 w-full" value={mode} onChange={(e) => setMode(e.target.value as 'vps' | 'webshare')}>
                      <NativeSelectOption value="vps">VPS 固定直出</NativeSelectOption>
                      <NativeSelectOption value="webshare">VPS＋Webshare</NativeSelectOption>
                    </NativeSelect>
                  </label>
                  <label htmlFor="claude-front" className="block text-sm">
                    使用哪台 VPS
                    <NativeSelect
                      id="claude-front"
                      className="mt-2 w-full"
                      value={vpsId}
                      onChange={(e) => setVpsId(e.target.value)}
                    >
                      {(data.vpsNodes || []).map((v) => (
                        <NativeSelectOption key={v.id} value={v.id}>
                          {v.name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                  <label htmlFor="claude-ip" className="block text-sm">
                    已核实的固定出口 IP
                    <Input
                      id="claude-ip"
                      className="mt-2"
                      value={expectedIp}
                      onChange={(e) => setExpectedIp(e.target.value)}
                    />
                  </label>
                  <p className="text-xs leading-6 text-muted-foreground">
                    {mode === 'webshare' ? '发布时复制当前 VPS 和 Webshare 端点，之后独立保存。' : '发布时复制所选 VPS 节点，之后独立保存；出口 IP 请填写该 VPS 实际公网出口。'}
                  </p>
                  <div className="flex gap-3">
                    <Button
                      disabled={!vpsId || !expectedIp.trim()}
                      onClick={() => void pin()}
                    >
                      保存并发布专用配置
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(false)}>
                      取消
                    </Button>
                  </div>
                </fieldset>
              )}
            </section>
          </>
        )}
        {message && (
          <output
            className="my-5 block rounded-xl border bg-card p-4 text-sm leading-6"
            aria-live="polite"
          >
            {message}
          </output>
        )}
        <div className="flex flex-wrap gap-5">
          <NextLink href="/connections">管理日常网络</NextLink>
          <NextLink href="/policies">添加国内直连网站</NextLink>
        </div>
      </div>
    </main>
  );
}
