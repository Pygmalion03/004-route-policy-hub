'use client';

import { CheckCircle2, ChevronDown, Copy, EthernetPort, Laptop, LoaderCircle, RefreshCw, Search, Smartphone, Wifi } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DevicePlan } from '@/lib/device-assignments';
import type { RuntimeAvailability, RuntimeState } from '@/lib/device-runtime-control';
import type { LanDevice, LanSnapshot } from '@/lib/lan-devices';

type Selection = {
  plan: DevicePlan;
  fetched: boolean;
  revision: number;
  verified: boolean;
  verifiedAt: string | null;
};
type Device = LanDevice & {
  selection: Selection | null;
  initialDefaultPlan?: 'direct';
  capabilities?: { canSwitch: boolean; canEnroll: boolean; supportsStrict: boolean; reason: string | null };
  oneClickPhase?: 'prepared' | 'active' | 'fallback-direct' | null;
};
type View = Omit<LanSnapshot, 'devices'> & {
  devices: Device[];
  controller: RuntimeAvailability;
  controllers?: RuntimeAvailability[];
  autoManagedMacs?: string[];
  autoEnrollmentConfigured?: boolean;
  oneClickController?: { available: boolean; reason: string | null };
};
type Mode = 'manageable' | 'online' | 'all';
const plans: Record<DevicePlan, string> = { flex: '新加坡分流 · SG', strict: '洛杉矶固定出口 · LA', direct: '家庭宽带直连' };
const endpoint = '/api/home-network/devices';
const auth = () => ({ 'x-admin-password': sessionStorage.getItem('route-list-password') || '' });

function verificationTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}


function describeState(device: Device, host: RuntimeState | null, automatic: boolean) {
  if (device.oneClickPhase === 'fallback-direct') return { label: '接入未完成', tone: 'warning', detail: '已回退直连，可重新选择新加坡分流。' };
  if (device.oneClickPhase === 'prepared') return { label: '正在准备接入', tone: 'warning', detail: '等待路由器完成单设备绑定。' };
  if (!host) return device.selection?.plan && device.selection.plan !== 'direct'
    ? { label: '方案已保存', tone: 'muted', detail: '尚未收到网关的应用确认。' }
    : { label: '默认直连', tone: 'muted', detail: '使用原有路由器与家庭宽带。' };
  if (host.status === 'failed') return { label: '需要检查', tone: 'warning', detail: host.reason || '网关暂时无法确认运行状态。' };
  const matches = host.activePlan === device.selection?.plan &&
    (automatic || host.appliedRevision === device.selection?.revision);
  if (host.status === 'active' && host.activePlan) return matches
    ? { label: automatic ? '已观察到流量' : '规则已应用', tone: 'good', detail: automatic ? '网关已观察到该设备报文；出口以设备实测为准。' : '网关已确认当前方案；出口以设备实测为准。' }
    : { label: '有待应用的方案', tone: 'warning', detail: '当前运行：' + plans[host.activePlan] };
  return { label: '等待设备流量', tone: 'warning', detail: host.reason || '首次接入后可断开并重连一次专用 Wi-Fi。' };
}

export function LanDevicePanel() {
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [mode, setMode] = useState<Mode>('manageable');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [feedbackKind, setFeedbackKind] = useState<'success' | 'error'>('success');
  const [privateLink, setPrivateLink] = useState<{ mac: string; url: string } | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { headers: auth(), signal, cache: 'no-store' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setView(next);
      setError('');
    } catch (problem) {
      if (!signal?.aborted) {
        setError(problem instanceof Error ? problem.message : '刷新失败');
        setView(current => current && {
          ...current, devices: current.devices.map(device => ({ ...device, online: null })),
        });
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => { void refresh(controller.signal); }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    }, 60000);
    return () => { controller.abort(); window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  function controllerFor(mac: string): RuntimeState | null {
    const candidates = view?.controllers || (view ? [view.controller] : []);
    return candidates.find((item): item is RuntimeState =>
      item.available && item.managedMac === mac) || null;
  }

  function updateSelection(mac: string, selection: Selection) {
    setView(current => current && {
      ...current,
      devices: current.devices.map(device => device.mac === mac ? { ...device, selection } : device),
    });
  }

  async function save(device: Device, plan: DevicePlan) {
    const controlled = Boolean(controllerFor(device.mac));
    const autoManaged = Boolean(view?.autoManagedMacs?.includes(device.mac));
    setPending(device.mac); setFeedbackKind('success'); setMessage(''); setPrivateLink(null);
    try {
      // One user selection is the entire action. Never pretend an unmanaged
      // client has switched when Q4/router one-click enrollment is unavailable.
      if (autoManaged || (!controlled && plan !== 'direct')) {
        const response = await fetch('/api/home-network/devices/switch', {
          method: 'POST',
          headers: { ...auth(), 'content-type': 'application/json' },
          body: JSON.stringify({ mac: device.mac, plan }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '自动接入失败，原设备继续宽带直连');
        updateSelection(device.mac, result.selection);
        setMessage(result.message);
        await refresh();
        return;
      }
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ mac: device.mac, plan }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      updateSelection(device.mac, result.selection);
      if (controlled) {
        const applyResponse = await fetch('/api/home-network/devices/apply', {
          method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
          body: JSON.stringify({ mac: device.mac, revision: result.selection.revision }),
        });
        const appliedResult = await applyResponse.json();
        if (!applyResponse.ok) {
          setFeedbackKind('error');
          setMessage(`「${plans[plan]}」计划已保存，但 Q4 没有确认应用：${appliedResult.error || '请检查控制器状态'}。原运行方案可能仍在使用。`);
          await refresh();
          return;
        }
        setView(current => current && {
          ...current,
          controller: current.controller.available && current.controller.managedMac === device.mac
            ? appliedResult.applied as RuntimeState : current.controller,
          controllers: (current.controllers || [current.controller]).map(item =>
            item.available && item.managedMac === device.mac ? appliedResult.applied as RuntimeState : item),
        });
        setMessage(`Q4 已确认应用「${plans[plan]}」到「${device.name}」。可在设备上核对出口。`);
      } else {
        setMessage(`已保存「${device.name}」的${plans[plan]}计划；此设备未授权实际切换，继续使用默认宽带线路。`);
      }
    } catch (problem) {
      setFeedbackKind('error');
      setMessage(problem instanceof Error ? problem.message : '保存或应用失败，请刷新查看实际状态');
      await refresh();
    } finally { setPending(''); }
  }

  async function apply(device: Device) {
    if (!device.selection) return;
    // A single explicit webpage action is enough; do not force per-device setup dialogs.
    setPending(device.mac); setFeedbackKind('success'); setMessage('正在应用线路…');
    try {
      const response = await fetch('/api/home-network/devices/apply', {
        method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ mac: device.mac, revision: device.selection.revision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setView(current => current && {
        ...current,
        controller: current.controller.available && current.controller.managedMac === device.mac
          ? result.applied as RuntimeState : current.controller,
        controllers: (current.controllers || [current.controller]).map(item =>
          item.available && item.managedMac === device.mac ? result.applied as RuntimeState : item),
      });
      setMessage(`Q4 已确认应用「${plans[device.selection.plan]}」到「${device.name}」；请在设备上核对实际公网 IP。`);
    } catch (problem) {
      setFeedbackKind('error');
      setMessage(problem instanceof Error ? problem.message : 'Q4 未确认切换，实际运行方案可能未改变');
      await refresh();
    } finally { setPending(''); }
  }

  async function verify(device: Device, verified: boolean) {
    if (!device.selection) return;
    setPending(device.mac); setFeedbackKind('success'); setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ mac: device.mac, revision: device.selection.revision, verified }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(result.error);
      }
      updateSelection(device.mac, result.selection);
      setMessage(verified
        ? `已记录「${device.name}」的人工验收。仅表示此版本方案曾经实测，不代表持续在线。`
        : `已撤销「${device.name}」的人工验收记录。`);
    } catch (problem) {
      setFeedbackKind('error');
      setMessage(problem instanceof Error ? problem.message : '记录验收失败');
    } finally { setPending(''); }
  }

  async function copySubscription(device: Device, platform: 'desktop' | 'ios') {
    setPending(device.mac); setFeedbackKind('success'); setMessage(''); setPrivateLink(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ mac: device.mac, platform }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const url = new URL(result.path, window.location.origin).toString();
      if (!navigator.clipboard?.writeText) {
        setPrivateLink({ mac: device.mac, url });
        setMessage('当前页面不支持自动复制，请手动复制下方私有地址。');
      } else {
        try {
          await navigator.clipboard.writeText(url);
          setMessage(`已复制「${device.name}」的私有客户端订阅。仅供安装 Clash 的设备导入，不会设置路由器网关。`);
        } catch {
          setPrivateLink({ mac: device.mac, url });
          setMessage('自动复制失败，请手动复制下方私有地址。');
        }
      }
    } catch (problem) {
      setFeedbackKind('error');
      setMessage(problem instanceof Error ? problem.message : '获取客户端订阅失败');
    } finally { setPending(''); }
  }


  const devices = view?.devices || [];
  const isManaged = (device: Device) => Boolean(controllerFor(device.mac));
  const canManage = (device: Device) => isManaged(device) || Boolean(device.capabilities?.canEnroll) ||
    (view?.oneClickController?.available === false && Boolean(device.selection));
  const managedCount = devices.filter(isManaged).length;
  const manageableCount = devices.filter(canManage).length;
  const onlineCount = devices.filter(device => device.online === true).length;
  const search = query.trim().toLowerCase();
  const visible = devices.filter(device => (
    mode === 'all' || (mode === 'online' ? device.online === true : canManage(device))
  ) && [device.name, device.ip, device.mac].some(value => value.toLowerCase().includes(search)))
    .sort((a, b) => Number(isManaged(b)) - Number(isManaged(a)) ||
      Number(b.online === true) - Number(a.online === true) || a.name.localeCompare(b.name, 'zh-CN'));

  return <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="lan-devices">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-5 sm:px-6">
      <div>
        <h2 id="lan-devices" className="text-lg font-semibold">设备列表</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {view ? managedCount + ' 台已接入网关 · ' + onlineCount + ' 台在线' : '正在读取设备…'}
        </p>
      </div>
      <Button variant="outline" disabled={loading || !!pending} onClick={() => { setLoading(true); void refresh(); }}>
        <RefreshCw aria-hidden="true" className={'size-4 ' + (loading ? 'animate-spin' : '')} />{loading ? '刷新中' : '刷新'}
      </Button>
    </div>
    <div className="flex flex-col gap-3 border-b bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex w-fit max-w-full gap-1 rounded-lg bg-muted p-1" aria-label="设备筛选">
        {([['manageable', '可管理', manageableCount], ['online', '在线', onlineCount], ['all', '全部', devices.length]] as const).map(([key, label, count]) =>
          <Button key={key} variant={mode === key ? 'default' : 'ghost'} aria-pressed={mode === key} size="sm" onClick={() => setMode(key)}>
            {label}<span className={mode === key ? 'text-primary-foreground/75' : 'text-muted-foreground'}>{count}</span>
          </Button>)}
      </div>
      <div className="relative w-full sm:max-w-72">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-10 bg-card pl-9" aria-label="搜索联网设备" placeholder="搜索设备、IP 或 MAC" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
    </div>
    {(error || view?.status === 'unavailable' || view?.status === 'unconfigured') && <p role="alert" className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 sm:mx-6">
      {error || (view?.status === 'unconfigured' ? '尚未连接路由器。以下仅显示保存过的设备。' : '暂时无法读取路由器，设备在线状态待更新。')}
    </p>}
    {view?.autoEnrollmentConfigured && view.oneClickController?.available === false && <p role="alert" className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900 sm:mx-6">自动接入控制器暂不可用。已保存的方案保留，请稍后刷新后再切换。</p>}
    {message && <p role={feedbackKind === 'error' ? 'alert' : 'status'} className={'mx-5 mt-4 rounded-lg border p-3 text-sm leading-6 sm:mx-6 ' +
      (feedbackKind === 'error' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-primary/15 bg-secondary/70 text-primary')}>{message}</p>}
    <div className="hidden grid-cols-[minmax(0,1fr)_13rem_14rem] gap-5 border-b px-6 py-3 text-xs font-medium text-muted-foreground lg:grid" aria-hidden="true">
      <span>设备</span><span>运行状态</span><span>上网线路 · 选择即应用</span>
    </div>
    <ul className="divide-y">
      {visible.map(device => {
        const host = controllerFor(device.mac);
        const automatic = Boolean(view?.autoManagedMacs?.includes(device.mac));
        const state = describeState(device, host, automatic);
        const capable = device.capabilities?.canSwitch ?? Boolean(host);
        const strictSupported = device.capabilities?.supportsStrict ?? (Boolean(host) && !automatic);
        const retry = Boolean(device.selection && host && !automatic &&
          (host.activePlan !== device.selection.plan || host.appliedRevision !== device.selection.revision));
        const wired = /有线|ethernet/i.test(device.link);
        const Icon = /iphone|ipad|android|手机|honor|magic|nova/i.test(device.name) ? Smartphone : wired ? EthernetPort : Laptop;
        const selected = device.selection?.plan || 'router-default';
        return <li key={device.mac} className="px-5 py-5 sm:px-6">
          <div className="grid min-w-0 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_13rem_14rem] lg:gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className={'grid size-11 shrink-0 place-items-center rounded-xl ' + (host ? 'bg-secondary text-primary' : 'bg-muted text-muted-foreground')}><Icon aria-hidden="true" className="size-5" /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{device.name}</h3>
                  <span className={'inline-flex items-center gap-1.5 text-xs ' + (device.online === true ? 'text-primary' : 'text-muted-foreground')}>
                    <span aria-hidden="true" className={'size-1.5 rounded-full ' + (device.online === true ? 'bg-emerald-600' : 'bg-muted-foreground/50')} />
                    {device.online === true ? '在线' : device.online === false ? '离线' : '状态未知'}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{device.ip || 'IP 待更新'}</span><span aria-hidden="true">·</span>
                  <span>{wired ? '有线连接' : device.capabilities?.canEnroll ? '专用 Wi-Fi' : device.link || '历史设备'}</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:block">
              <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ' +
                (state.tone === 'good' ? 'bg-secondary text-primary' : state.tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-muted text-muted-foreground')}>
                {pending === device.mac ? <><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />正在切换</> : state.label}
              </span>
              {device.selection?.verified && <p className="flex items-center gap-1 text-xs text-muted-foreground lg:mt-1.5"><CheckCircle2 aria-hidden="true" className="size-3.5 text-primary" />此方案已人工实测</p>}
            </div>
            <div className="min-w-0">
              <label className="sr-only" htmlFor={'plan-' + device.mac}>为 {device.name} 选择上网线路</label>
              <select id={'plan-' + device.mac} aria-label={device.name + '（' + device.mac + '）上网线路'}
                className="h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-65"
                value={selected} disabled={!!pending || !!error || !capable} onChange={event => void save(device, event.target.value as DevicePlan)}>
                <option value="router-default" disabled>家庭宽带直连 · 默认</option>
                <option value="direct">{plans.direct}</option>
                <option value="flex">{plans.flex}</option>
                <option value="strict" disabled={!strictSupported}>{plans.strict}{strictSupported ? '' : '（暂未开放）'}</option>
              </select>
              {!capable && device.capabilities?.reason && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{device.capabilities.reason}</p>}
              {capable && !strictSupported && <p className="mt-1.5 text-xs text-muted-foreground">支持 SG 与直连</p>}
              {automatic && capable && device.oneClickPhase === 'fallback-direct' && <Button className="mt-2" size="sm" variant="outline" disabled={!!pending || !!error} onClick={() => void save(device, 'flex')}>重试新加坡接入</Button>}
              {retry && <Button className="mt-2" size="sm" variant="outline" disabled={!!pending || !!error || host?.status === 'failed'} onClick={() => void apply(device)}>重试应用已选线路</Button>}
            </div>
          </div>
          <details id={'details-' + device.mac.replaceAll(':', '')} className="group mt-3 text-sm">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">
              详情与实测<ChevronDown aria-hidden="true" className="size-3.5 transition group-open:rotate-180" />
            </summary>
            <div className="mt-3 grid gap-4 rounded-xl bg-muted/45 p-4 sm:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold text-foreground">连接与状态</h4>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">{state.detail}</p>
                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5 text-muted-foreground">
                  <dt>MAC</dt><dd className="break-all font-mono">{device.mac.toUpperCase()}</dd>
                  <dt>接入</dt><dd>{device.link || '未知'}{device.wifiInterfaceAlias ? ' · ' + device.wifiInterfaceAlias : ''}</dd>
                  {host?.appliedAt && <><dt>应用时间</dt><dd>{verificationTime(host.appliedAt)}</dd></>}
                  {device.selection?.verified && <><dt>实测记录</dt><dd>{verificationTime(device.selection.verifiedAt)} · 历史记录</dd></>}
                </dl>
                {host?.reason && host.reason !== state.detail && <p className="mt-2 text-xs leading-5 text-muted-foreground">{host.reason}</p>}
                {device.selection?.plan === 'direct' && host && <p className="mt-2 text-xs leading-5 text-muted-foreground">已接入的设备仍经 Q4 转发，出口使用家庭宽带。</p>}
                {device.oneClickPhase === 'active' && host?.status !== 'active' && <p className="mt-2 text-xs leading-5 text-amber-800">首次接入可断开并重连一次专用 Wi-Fi，随后刷新列表。</p>}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-foreground">出口实测</h4>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">设备上检查过出口后，可记录结果。此记录不会改变线路，也不代表持续检测。</p>
                {device.selection ? <Button className="mt-2" variant="outline" size="sm" disabled={!!pending || !!error} onClick={() => void verify(device, !device.selection?.verified)}>
                  {device.selection.verified ? '撤销实测记录' : '记录实测通过'}
                </Button> : <p className="mt-2 text-xs text-muted-foreground">选择线路后可记录实测。</p>}
              </div>
              {device.selection && <details className="border-t pt-3 sm:col-span-2">
                <summary className="w-fit cursor-pointer text-xs font-medium text-muted-foreground">客户端订阅（仅已有客户端需要）</summary>
                <div className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                  <p>通过 Q4 上网无需订阅。此处用于维护仍使用 Clash / Mihomo 的客户端。</p>
                  {device.selection.plan === 'direct' ? <p>直连方案无需代理订阅。</p> : <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={!!pending || !!error} onClick={() => void copySubscription(device, 'desktop')}><Copy aria-hidden="true" className="size-3.5" />电脑 / 安卓</Button>
                    <Button size="sm" variant="outline" disabled={!!pending || !!error} onClick={() => void copySubscription(device, 'ios')}><Copy aria-hidden="true" className="size-3.5" />iPhone / iPad</Button>
                  </div>}
                  {privateLink?.mac === device.mac && <div className="space-y-2">
                    <Input readOnly value={privateLink.url} aria-label={device.name + ' 私有订阅地址'} onFocus={event => event.currentTarget.select()} />
                    <Button size="sm" variant="ghost" onClick={() => setPrivateLink(null)}>隐藏地址</Button>
                  </div>}
                </div>
              </details>}
            </div>
          </details>
        </li>;
      })}
    </ul>
    {loading && !view && <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取联网设备</div>}
    {!!view && !visible.length && <div className="px-6 py-12 text-center">
      <Wifi aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">{query ? '没有找到匹配的设备' : mode === 'manageable' ? '暂时没有可管理的设备' : '暂无设备'}</p>
      <p className="mt-2 text-xs leading-6 text-muted-foreground">{query ? '试试设备名、IP 或 MAC 地址。' : '新设备连接专用 Wi-Fi 后刷新，也可查看全部设备。'}</p>
      {mode !== 'all' && <Button variant="outline" size="sm" className="mt-4" onClick={() => { setMode('all'); setQuery(''); }}>查看全部设备</Button>}
    </div>}
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 border-t bg-muted/20 px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
      <span>{view?.observedAt ? '路由器设备名单 · ' + new Date(view.observedAt).toLocaleTimeString('zh-CN') + ' 更新' : '设备名单由路由器提供'}</span>
      <span>运行状态与出口实测分别记录</span>
    </div>
  </section>;
}
