'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Check,
  CircleGauge,
  Cloud,
  Code2,
  Copy,
  KeyRound,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type {
  MatcherType,
  Policy,
  PolicyAction,
  PolicyKind,
  PolicyStore,
} from '@/lib/policies';

type ApiStore = PolicyStore & { requiresPassword?: boolean };
type SyncState = 'loading' | 'saved' | 'saving' | 'error';

const kindLabels: Record<PolicyKind, string> = {
  service: '服务',
  website: '网站',
  app: '应用',
  network: '网络',
};

const matcherLabels: Record<MatcherType, string> = {
  DOMAIN: '完整域名',
  'DOMAIN-SUFFIX': '域名及其子域名',
  'DOMAIN-KEYWORD': '域名关键词',
  'IP-CIDR': 'IPv4 网段',
  'IP-CIDR6': 'IPv6 网段',
  'PROCESS-NAME': '应用进程名',
};

export function PolicyConsole({
  initialStore,
  initialRequiresPassword,
}: {
  initialStore: PolicyStore;
  initialRequiresPassword: boolean;
}) {
  const [policies, setPolicies] = useState<Policy[]>(initialStore.policies);
  const policiesRef = useRef<Policy[]>(initialStore.policies);
  const [query, setQuery] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('saved');
  const [updatedAt, setUpdatedAt] = useState(initialStore.updatedAt);
  const [error, setError] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(initialRequiresPassword);
  const [password, setPassword] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [origin, setOrigin] = useState('http://你的极空间地址:8787');

  useEffect(() => {
    policiesRef.current = policies;
    policiesRefForTools.current = policies;
  }, [policies]);

  async function loadPolicies() {
    setSyncState('loading');
    setError('');
    try {
      const response = await fetch('/api/policies', { cache: 'no-store' });
      const data = (await response.json()) as ApiStore & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取清单失败');
      setPolicies(data.policies);
      setUpdatedAt(data.updatedAt);
      setRequiresPassword(Boolean(data.requiresPassword));
      setSyncState('saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取清单失败');
      setSyncState('error');
    }
  }

  const persistPolicies = useCallback(
    async (nextPolicies: Policy[]) => {
      const previous = policiesRef.current;
      policiesRef.current = nextPolicies;
      setPolicies(nextPolicies);
      setSyncState('saving');
      setError('');
      try {
        const response = await fetch('/api/policies', {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            ...((password || window.sessionStorage.getItem('route-list-password'))
              ? { 'x-admin-password': password || window.sessionStorage.getItem('route-list-password') || '' }
              : {}),
          },
          body: JSON.stringify({
            version: 1,
            updatedAt,
            policies: nextPolicies,
          }),
        });
        const data = (await response.json()) as PolicyStore & { error?: string };
        if (!response.ok) throw new Error(data.error || '保存失败');
        policiesRef.current = data.policies;
        setPolicies(data.policies);
        setUpdatedAt(data.updatedAt);
        setSyncState('saved');
      } catch (cause) {
        policiesRef.current = previous;
        setPolicies(previous);
        setError(cause instanceof Error ? cause.message : '保存失败');
        setSyncState('error');
      }
    },
    [password, updatedAt],
  );

  const visiblePolicies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return policies;
    return policies.filter((policy) =>
      [
        policy.name,
        policy.description,
        ...policy.matchers.map((matcher) => matcher.value),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [policies, query]);

  const counts = policies.reduce(
    (total, policy) => {
      if (policy.enabled) total[policy.action] += 1;
      return total;
    },
    { DIRECT: 0, PROXY: 0 },
  );

  function updatePolicy(id: string, patch: Partial<Policy>) {
    void persistPolicies(
      policies.map((policy) =>
        policy.id === id ? { ...policy, ...patch } : policy,
      ),
    );
  }

  function addPolicy(policy: Policy) {
    void persistPolicies([...policies, policy]);
    setAddOpen(false);
  }

  function deletePolicy(id: string) {
    void persistPolicies(policies.filter((policy) => policy.id !== id));
  }

  function savePassword(value: string) {
    setPassword(value);
    window.sessionStorage.setItem('route-list-password', value);
  }

  useRoutingTools(persistPolicies);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-5 sm:px-7 sm:py-8">
        <header className="flex flex-col gap-5 border-b border-border/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_24px_rgba(15,76,66,0.18)]">
              <Network className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.02em]">分流清单</h1>
                <Badge className="bg-emerald-100 text-emerald-800">私人</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                一处修改，所有设备使用同一决定
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {requiresPassword && (
              <PasswordControl password={password} onSave={savePassword} />
            )}
            <SyncStatus state={syncState} updatedAt={updatedAt} />
          </div>
        </header>

        {error && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void loadPolicies()}>
              <RefreshCw />
              重试
            </Button>
          </div>
        )}

        <section className="grid gap-3 py-6 sm:grid-cols-3">
          <SummaryCard
            icon={<ShieldCheck className="size-4" />}
            label="直连"
            value={counts.DIRECT}
            note="本地与低延迟流量"
            tone="direct"
          />
          <SummaryCard
            icon={<Cloud className="size-4" />}
            label="代理"
            value={counts.PROXY}
            note="有出口地区要求"
            tone="proxy"
          />
          <SummaryCard
            icon={<CircleGauge className="size-4" />}
            label="清单"
            value={policies.length}
            note="统一供所有设备获取"
            tone="neutral"
          />
        </section>

        <section className="overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_18px_60px_rgba(32,48,44,0.06)]">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="font-semibold tracking-[-0.01em]">统一决定</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                系统差异由工具内部处理，默认无需区分设备
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索服务或域名"
                  className="h-9 bg-background pl-9"
                  aria-label="搜索规则"
                />
              </div>
              <Button size="lg" className="h-9 px-3.5" onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" />
                添加
              </Button>
            </div>
          </div>

          {syncState === 'loading' ? (
            <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin" /> 正在读取清单
              </span>
            </div>
          ) : visiblePolicies.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-5 text-center">
              <div>
                <Search className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-3 font-medium">没有找到对应规则</p>
                <p className="mt-1 text-sm text-muted-foreground">换一个名称或域名试试</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visiblePolicies.map((policy) => (
                <PolicyRow
                  key={policy.id}
                  policy={policy}
                  onUpdate={(patch) => updatePolicy(policy.id, patch)}
                  onDelete={() => deletePolicy(policy.id)}
                />
              ))}
            </div>
          )}

          <footer className="flex flex-col gap-3 border-t border-border bg-muted/25 px-4 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="size-4 text-amber-600" />
              保存后，Clash 会在下次更新时自动获取
            </p>
            <Button variant="outline" className="bg-background" onClick={() => { setOrigin(window.location.origin); setIntegrationOpen(true); }}>
              <Code2 data-icon="inline-start" />
              Clash 接入方式
            </Button>
          </footer>
        </section>
      </div>

      <AddPolicyDialog open={addOpen} onOpenChange={setAddOpen} onAdd={addPolicy} />
      <IntegrationDialog open={integrationOpen} onOpenChange={setIntegrationOpen} origin={origin} />
    </main>
  );
}

function PolicyRow({
  policy,
  onUpdate,
  onDelete,
}: {
  policy: Policy;
  onUpdate: (patch: Partial<Policy>) => void;
  onDelete: () => void;
}) {
  const matchSummary = policy.matchers
    .slice(0, 2)
    .map((matcher) => matcher.value)
    .join(' · ');
  const remaining = policy.matchers.length - 2;

  return (
    <article className="grid gap-4 px-4 py-4 transition-colors hover:bg-muted/35 sm:grid-cols-[minmax(220px,1.25fr)_minmax(180px,1fr)_auto_auto_auto] sm:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium">{policy.name}</h3>
          <Badge variant="outline" className="bg-background text-muted-foreground">
            {kindLabels[policy.kind]}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">{policy.description}</p>
      </div>

      <code className="truncate rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground" title={policy.matchers.map((matcher) => `${matcher.type},${matcher.value}`).join('\n')}>
        {matchSummary}{remaining > 0 ? ` · +${remaining}` : ''}
      </code>

      <div className="grid grid-cols-2 rounded-xl bg-muted p-1" aria-label={`${policy.name} 的分流决定`}>
        <button
          type="button"
          onClick={() => onUpdate({ action: 'DIRECT' })}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${policy.action === 'DIRECT' ? 'bg-white text-emerald-800 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          直连
        </button>
        <button
          type="button"
          onClick={() => onUpdate({ action: 'PROXY' })}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${policy.action === 'PROXY' ? 'bg-white text-indigo-700 shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          代理
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="text-xs text-muted-foreground sm:hidden">启用规则</span>
        <Switch
          checked={policy.enabled}
          onCheckedChange={(checked) => onUpdate({ enabled: checked })}
          aria-label={`${policy.name} 启用状态`}
        />
      </div>

      <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`删除 ${policy.name}`} className="text-muted-foreground hover:text-destructive">
        <Trash2 />
      </Button>
    </article>
  );
}

function AddPolicyDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (policy: Policy) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<PolicyKind>('website');
  const [matcherType, setMatcherType] = useState<MatcherType>('DOMAIN-SUFFIX');
  const [values, setValues] = useState('');
  const [action, setAction] = useState<PolicyAction>('DIRECT');

  function submit() {
    const matcherValues = values
      .split(/[\n,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!name.trim() || matcherValues.length === 0) return;
    const idBase = name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    onAdd({
      id: `${idBase || 'policy'}-${Date.now().toString(36)}`,
      name: name.trim(),
      description: description.trim(),
      kind,
      action,
      enabled: true,
      matchers: matcherValues.map((value) => ({
        type: matcherType,
        value,
        ...(matcherType.startsWith('IP-CIDR') ? { noResolve: true } : {}),
      })),
    });
    setName('');
    setDescription('');
    setValues('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加一项决定</DialogTitle>
          <DialogDescription>网站、应用和网络都放在同一份清单中。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <label htmlFor="policy-name" className="grid gap-1.5 text-sm font-medium">
            名称
            <Input id="policy-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：GitHub" />
          </label>
          <label htmlFor="policy-description" className="grid gap-1.5 text-sm font-medium">
            备注
            <Input id="policy-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="为什么要这样分流（可选）" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              类型
              <NativeSelect className="w-full" value={kind} onChange={(event) => setKind(event.target.value as PolicyKind)}>
                {Object.entries(kindLabels).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              匹配方式
              <NativeSelect className="w-full" value={matcherType} onChange={(event) => setMatcherType(event.target.value as MatcherType)}>
                {Object.entries(matcherLabels).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          </div>
          <label htmlFor="policy-matchers" className="grid gap-1.5 text-sm font-medium">
            匹配内容
            <Textarea id="policy-matchers" value={values} onChange={(event) => setValues(event.target.value)} placeholder={'每行一个，例如：\ngithub.com\ngithubusercontent.com'} className="min-h-28 font-mono text-xs" />
          </label>
          <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
            <button type="button" onClick={() => setAction('DIRECT')} className={`rounded-lg px-3 py-2 text-sm font-medium ${action === 'DIRECT' ? 'bg-white text-emerald-800 shadow-sm' : 'text-muted-foreground'}`}>直连</button>
            <button type="button" onClick={() => setAction('PROXY')} className={`rounded-lg px-3 py-2 text-sm font-medium ${action === 'PROXY' ? 'bg-white text-indigo-700 shadow-sm' : 'text-muted-foreground'}`}>代理</button>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={submit} disabled={!name.trim() || !values.trim()}>添加并同步</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationDialog({ open, onOpenChange, origin }: { open: boolean; onOpenChange: (open: boolean) => void; origin: string }) {
  const [proxyGroup, setProxyGroup] = useState('PROXY');
  const snippet = `# ① Clash Verge Rev：扩展配置（Merge）\nrule-providers:\n  my-direct:\n    type: http\n    behavior: classical\n    format: yaml\n    url: "${origin}/rules/direct.yaml"\n    path: ./rule-providers/my-direct.yaml\n    interval: 3600\n    proxy: DIRECT\n  my-proxy:\n    type: http\n    behavior: classical\n    format: yaml\n    url: "${origin}/rules/proxy.yaml"\n    path: ./rule-providers/my-proxy.yaml\n    interval: 3600\n    proxy: DIRECT\n\n# ② Clash Verge Rev：规则配置（Rules）\nprepend:\n  - "RULE-SET,my-direct,DIRECT"\n  - "RULE-SET,my-proxy,${proxyGroup || 'PROXY'}"\nappend: []\ndelete: []`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>让 Clash 自动获取</DialogTitle>
          <DialogDescription>分别加入当前订阅的“扩展配置”和“规则配置”；规则每小时更新一次。</DialogDescription>
        </DialogHeader>
        <label htmlFor="proxy-group" className="grid gap-1.5 text-sm font-medium">
          你的代理策略组名称
          <Input id="proxy-group" value={proxyGroup} onChange={(event) => setProxyGroup(event.target.value)} placeholder="例如：节点选择" />
        </label>
        <pre className="max-h-[46vh] overflow-auto rounded-xl bg-[#17211f] p-4 text-xs leading-5 text-emerald-50"><code>{snippet}</code></pre>
        <p className="text-xs text-muted-foreground">Rules 使用 prepend，确保个人决定优先于订阅规则；路由器也可以引用同样的两个地址。</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
          <Button onClick={() => void navigator.clipboard.writeText(snippet)}><Copy />复制配置</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordControl({ password, onSave }: { password: string; onSave: (password: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(password);
  return (
    <>
      <Button variant="outline" className="bg-card" onClick={() => { setDraft(window.sessionStorage.getItem('route-list-password') || password); setOpen(true); }}>
        <KeyRound /> {password ? '已解锁编辑' : '解锁编辑'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>管理密码</DialogTitle>
            <DialogDescription>密码只保存在当前浏览器会话中。</DialogDescription>
          </DialogHeader>
          <Input type="password" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
            <Button onClick={() => { onSave(draft); setOpen(false); }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SyncStatus({ state, updatedAt }: { state: SyncState; updatedAt: string }) {
  const content = {
    loading: { icon: <LoaderCircle className="size-4 animate-spin" />, label: '读取中', className: 'border-border bg-card text-muted-foreground' },
    saving: { icon: <RefreshCw className="size-4 animate-spin" />, label: '同步中', className: 'border-amber-200 bg-amber-50 text-amber-900' },
    saved: { icon: <Check className="size-4" />, label: '规则已同步', className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
    error: { icon: <RefreshCw className="size-4" />, label: '同步失败', className: 'border-red-200 bg-red-50 text-red-800' },
  }[state];
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${content.className}`}>
      {content.icon}<span className="font-medium">{content.label}</span>{time && <span className="opacity-65">{time}</span>}
    </div>
  );
}

function SummaryCard({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: number; note: string; tone: 'direct' | 'proxy' | 'neutral' }) {
  const toneClass = { direct: 'bg-emerald-100 text-emerald-800', proxy: 'bg-indigo-100 text-indigo-700', neutral: 'bg-amber-100 text-amber-800' }[tone];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className={`grid size-8 place-items-center rounded-xl ${toneClass}`}>{icon}</div>
        <strong className="text-2xl font-semibold tracking-[-0.04em]">{value}</strong>
      </div>
      <p className="mt-3 text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function useRoutingTools(persistPolicies: (policies: Policy[]) => Promise<void>) {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool({
        name: 'list_routing_policies',
        title: '查看分流清单',
        description: '列出当前所有服务的直连或代理决定。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute() {
          return policiesRefForTools.current.map(({ id, name, action, enabled }) => ({ id, name, action, enabled }));
        },
      }, { signal: lifecycle.signal });
      await context.registerTool({
        name: 'set_routing_decision',
        title: '设置分流决定',
        description: '按规则 ID 将一个服务设为直连或代理，并立即同步。',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '规则 ID' },
            action: { type: 'string', enum: ['DIRECT', 'PROXY'] },
          },
          required: ['id', 'action'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input: unknown) {
          const value = input as { id?: string; action?: PolicyAction };
          if (!value.id || !['DIRECT', 'PROXY'].includes(value.action || '')) throw new Error('无效的规则 ID 或决定');
          const current = policiesRefForTools.current;
          if (!current.some((policy) => policy.id === value.id)) throw new Error('找不到这条规则');
          const next = current.map((policy) => policy.id === value.id ? { ...policy, action: value.action as PolicyAction } : policy);
          await persistPolicies(next);
          return { id: value.id, action: value.action, status: 'saved' };
        },
      }, { signal: lifecycle.signal });
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, [persistPolicies]);
}

const policiesRefForTools: { current: Policy[] } = { current: [] };
