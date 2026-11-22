'use client';

import Link from 'next/link';
import { ArrowUpRight, Globe2, LockKeyhole, Monitor, Router, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Policy, PolicyAction, PolicyStore } from '@/lib/policies';

const honor: Policy = {
  id: 'honor-connect', name: '荣耀超级工作台 / 投屏', kind: 'app', enabled: true, action: 'DIRECT',
  description: 'Mac 本机默认直连',
  matchers: [
    'Hihonornote', 'HnOfficeCenter', 'HnMirror', 'HonorConnect Helper',
    'HonorConnect Helper (GPU)', 'HonorConnect Helper (Renderer)', 'HonorConnect Helper (Plugin)', 'HonorConnect Login Helper',
  ].map(value => ({ type: 'PROCESS-NAME', value })),
};

export function HomePolicyPanel({ store, setStore, nodes }: {
  store: PolicyStore; setStore: (store: PolicyStore) => void;
  nodes: { id: string; name: string }[];
}) {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackArea, setFeedbackArea] = useState<'plans' | 'rules'>('plans');
  const [privateLink, setPrivateLink] = useState('');
  const find = search.trim().toLowerCase();
  const listed = store.policies.some(policy => policy.id === honor.id) ? store.policies : [honor, ...store.policies];
  const rules = listed.filter(policy => policy.kind !== 'network' &&
    [policy.name, ...policy.matchers.map(matcher => matcher.value)].some(value => value.toLowerCase().includes(find)));
  const networks = listed.filter(policy => policy.kind === 'network');

  async function save(next: PolicyStore, key: string, success: string, area: 'plans' | 'rules' = 'plans') {
    setPending(key); setFeedback(''); setFeedbackArea(area); setPrivateLink('');
    try {
      const response = await fetch('/api/policies', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-admin-password': sessionStorage.getItem('route-list-password') || '' },
        body: JSON.stringify(next),
      });
      const result = await response.json();
      if (response.status === 409) {
        const { version, updatedAt, policies, flexDirectFallback, strictVpsId } = result;
        setStore({ version, updatedAt, policies, flexDirectFallback, strictVpsId });
        setFeedback('规则已被另一处修改，已刷新列表。请核对后再切换。');
        return;
      }
      if (!response.ok) throw new Error(result.error);
      setStore(result); setFeedback(success);
    } catch (error) { setFeedback(error instanceof Error ? error.message : '保存失败'); }
    finally { setPending(''); }
  }
  function switchRule(rule: Policy, action: PolicyAction | 'default') {
    const next = { ...rule, action: action === 'default' ? rule.action : action, enabled: action !== 'default' };
    const policies = store.policies.some(policy => policy.id === rule.id)
      ? store.policies.map(policy => policy.id === rule.id ? next : policy)
      : [...store.policies, next];
    void save({ ...store, policies }, rule.id, `已保存「${rule.name}」，等待客户端同步。`, 'rules');
  }
  async function copyPlan(client: 'flex' | 'strict-mac' | 'strict-ios') {
    setPending('copy'); setFeedback(''); setFeedbackArea('plans'); setPrivateLink('');
    try {
      const response = await fetch(`/api/connections?client=${client}`, {
        method: 'POST', headers: { 'x-admin-password': sessionStorage.getItem('route-list-password') || '' },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!navigator.clipboard) {
        setPrivateLink(result.url);
        setFeedback('当前浏览器不支持自动复制，请手动复制下方地址。');
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setFeedback(`已复制私有订阅。${client === 'strict-mac' ? '在 Clash Verge 导入，使用规则模式并开启 TUN。' : client === 'strict-ios' ? '在 Clash Mi 导入，选择「内置-不覆写」与规则模式。' : '在需要这套方案的客户端导入。'}`);
    } catch (error) { setFeedback(error instanceof Error ? error.message : '复制失败'); }
    finally { setPending(''); }
  }

  const strictVps = nodes.some(node => node.id === store.strictVpsId) ? store.strictVpsId : '';
  const manualFallback = pending === 'fallback-on' || (pending !== 'fallback-off' && Boolean(store.flexDirectFallback));
  return <>
  <section aria-labelledby="home-plans">
    <h2 id="home-plans" className="mb-3 text-lg font-semibold">三套共用方案</h2>
    <div className="grid gap-3 md:grid-cols-3">
      <article className="flex min-w-0 flex-col rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><SlidersHorizontal className="size-5" /></span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">Windows · 部分安卓</span>
        </div>
        <h3 className="mt-4 text-xl font-semibold">灵活分流</h3>
        <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">国内自动直连，其余走所选线路。手头的 Windows 配置可继续用。</p>
        <div className="mt-4 border-t pt-4">
          <label className="flex w-fit items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4 accent-primary" checked={manualFallback} disabled={!!pending}
              onChange={event => {
                const allowed = event.target.checked;
                void save({ ...store, flexDirectFallback: allowed }, allowed ? 'fallback-on' : 'fallback-off',
                  allowed ? '已保存；刷新灵活分流订阅后，客户端可手动选择宽带直连。' : '已关闭；刷新灵活分流订阅后，客户端移除宽带兜底。');
              }} />
            允许手动切宽带兜底
          </label>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">仅影响这套订阅，不自动切换。</p>
          <Button variant="outline" className="mt-3" disabled={!!pending} onClick={() => void copyPlan('flex')}>复制分流订阅</Button>
        </div>
      </article>
      <article className="flex min-w-0 flex-col rounded-2xl border border-primary/35 bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></span>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-primary">Mac · iPhone</span>
        </div>
        <h3 className="mt-4 text-xl font-semibold">严格 VPS</h3>
        <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">指定例外保留直连，其余只走选定 VPS。线路故障时不转宽带。</p>
        <div className="mt-4 border-t pt-4">
          <label className="grid gap-2 text-sm font-medium">共用 VPS
            <select className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" value={strictVps} disabled={!!pending || !nodes.length}
              onChange={event => void save({ ...store, strictVpsId: event.target.value }, 'strict', '已保存共用 VPS。已导入此方案的客户端需要刷新订阅。')}>
              <option value="" disabled>{nodes.length ? '选择现有 VPS' : '尚未配置 VPS'}</option>
              {nodes.map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" disabled={!!pending || !strictVps} onClick={() => void copyPlan('strict-mac')}>复制 Mac 订阅</Button>
            <Button variant="outline" disabled={!!pending || !strictVps} onClick={() => void copyPlan('strict-ios')}>复制 iPhone 订阅</Button>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">客户端退出后的整机断网保护待实测。</p>
        </div>
      </article>
      <article className="flex min-w-0 flex-col rounded-2xl border bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-primary"><Router className="size-5" /></span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">其他设备</span>
        </div>
        <h3 className="mt-4 text-xl font-semibold">中兴直连</h3>
        <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">用原有中兴网关，所有流量直接走家庭宽带，不依赖 NAS 或 VPS。</p>
        <div className="mt-4 border-t pt-4">
          <p className="text-sm font-medium">无需订阅</p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">保持原来的 Wi-Fi 或有线连接，停用设备上已有的代理即可。</p>
        </div>
      </article>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 leading-5">
      <p className="text-xs text-muted-foreground">首次导入后由客户端执行；页面显示方案设置，不显示设备实际出口。</p>
      <output aria-live="polite" className="text-xs text-primary">{feedbackArea === 'plans' && feedback}</output>
    </div>
    {privateLink && <div className="mt-3 flex items-center gap-2"><Input readOnly value={privateLink} aria-label="私有订阅地址" onFocus={event => event.currentTarget.select()} /><Button variant="outline" onClick={() => setPrivateLink('')}>隐藏</Button></div>}
  </section>
  <section className="min-w-0 rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="home-exceptions">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="home-exceptions" className="text-lg font-semibold">软件与网站规则</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">点选即保存。代理跟随设备选中的线路；直连组不读此清单。</p>
      </div>
      <Link href="/policies" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">添加 / 细改规则<ArrowUpRight className="size-3.5" /></Link>
    </div>
    <div className="relative mt-4">
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="h-10 pl-9" aria-label="搜索软件或网站" placeholder="搜索软件、网站或域名" value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    <output aria-live="polite" className="mt-2 block min-h-5 text-xs leading-5 text-primary">{feedbackArea === 'rules' && feedback}</output>
    <ul className="divide-y">
      {rules.map(rule => {
        const onlyProcess = rule.matchers.every(matcher => matcher.type === 'PROCESS-NAME');
        const hasMacDefault = rule.id === honor.id || rule.matchers.some(matcher => matcher.type === 'PROCESS-NAME' && matcher.value === 'UURemote');
        const active = rule.enabled ? rule.action : 'default';
        const localDefault = rule === honor;
        const options = [['DIRECT', '直连'], ['PROXY', '走代理'], ...(!rule.enabled || !hasMacDefault ? [['default', '跟随默认']] : [])] as [PolicyAction | 'default', string][];
        return <li key={rule.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary">{onlyProcess ? <Monitor className="size-4" /> : <Globe2 className="size-4" />}</span>
            <div className="min-w-0 break-words">
              <p className="text-sm font-semibold">{rule.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{localDefault ? 'Mac 本机默认' : onlyProcess ? '支持进程识别的客户端' : '域名 / 服务规则'}{!rule.enabled && ' · 未启用'}</p>
            </div>
          </div>
          <fieldset aria-label={`${rule.name} 的路线`} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {options.map(([action, label]) => <Button key={action} variant={active === action ? 'default' : 'ghost'} size="sm"
              disabled={!!pending} aria-pressed={action === active} onClick={() => { if (action !== active) switchRule(rule, action); }}>{label}</Button>)}
          </fieldset>
        </li>;
      })}
      {!rules.length && <li className="py-6 text-center text-sm text-muted-foreground">没有匹配的规则。</li>}
    </ul>
    <p className="mt-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mr-1 inline size-3" />固定通道：{[...networks.filter(rule => rule.enabled).map(rule => rule.name), '已配置的 iPhone Claude 专用出口'].join(' · ')}。旧 Mac 本机脚本需更新，才能覆盖荣耀和 UU 的默认直连。</p>
  </section>
  </>;
}
