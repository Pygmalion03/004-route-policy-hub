import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type PolicyAction = 'DIRECT' | 'PROXY';
export type PolicyKind = 'service' | 'website' | 'app' | 'network';
export type MatcherType =
  | 'DOMAIN'
  | 'DOMAIN-SUFFIX'
  | 'DOMAIN-KEYWORD'
  | 'IP-CIDR'
  | 'IP-CIDR6'
  | 'PROCESS-NAME';

export type PolicyMatcher = {
  type: MatcherType;
  value: string;
  noResolve?: boolean;
};

export type Policy = {
  id: string;
  name: string;
  description: string;
  kind: PolicyKind;
  action: PolicyAction;
  enabled: boolean;
  matchers: PolicyMatcher[];
};

export type PolicyStore = {
  version: 1;
  updatedAt: string;
  policies: Policy[];
};

const matcherTypes = new Set<MatcherType>([
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'IP-CIDR6',
  'PROCESS-NAME',
]);

const initialPolicies: Policy[] = [
  {
    id: 'chatgpt-openai',
    name: 'ChatGPT / OpenAI',
    description: '对出口地区有要求',
    kind: 'service',
    action: 'PROXY',
    enabled: true,
    matchers: [
      { type: 'DOMAIN-SUFFIX', value: 'chatgpt.com' },
      { type: 'DOMAIN-SUFFIX', value: 'openai.com' },
      { type: 'DOMAIN-SUFFIX', value: 'oaistatic.com' },
      { type: 'DOMAIN-SUFFIX', value: 'oaiusercontent.com' },
      { type: 'PROCESS-NAME', value: 'ChatGPT' },
      { type: 'PROCESS-NAME', value: 'codex' },
      { type: 'PROCESS-NAME', value: 'Codex (Service)' },
    ],
  },
  {
    id: 'google-youtube',
    name: 'Google / YouTube',
    description: '海外服务统一代理',
    kind: 'service',
    action: 'PROXY',
    enabled: true,
    matchers: [
      { type: 'DOMAIN-SUFFIX', value: 'google.com' },
      { type: 'DOMAIN-SUFFIX', value: 'googleapis.com' },
      { type: 'DOMAIN-SUFFIX', value: 'gstatic.com' },
      { type: 'DOMAIN-SUFFIX', value: 'youtube.com' },
      { type: 'DOMAIN-SUFFIX', value: 'googlevideo.com' },
    ],
  },
  {
    id: 'agedm',
    name: 'AGE 动漫',
    description: '代理出口可能返回 403',
    kind: 'website',
    action: 'DIRECT',
    enabled: true,
    matchers: [
      { type: 'DOMAIN-SUFFIX', value: 'agedm.io' },
      { type: 'DOMAIN-SUFFIX', value: 'iagefans.com' },
    ],
  },
  {
    id: 'uu-remote',
    name: 'UU 远程',
    description: '保持低延迟，避免远控流量走节点',
    kind: 'app',
    action: 'DIRECT',
    enabled: true,
    matchers: [
      { type: 'PROCESS-NAME', value: 'UURemote' },
      { type: 'PROCESS-NAME', value: 'UURemoteServer' },
      { type: 'PROCESS-NAME', value: 'UURemoteService' },
      { type: 'PROCESS-NAME', value: 'UURemoteDaemon' },
    ],
  },
  {
    id: 'tailscale',
    name: 'Tailscale',
    description: '避免套入第二层代理',
    kind: 'network',
    action: 'DIRECT',
    enabled: true,
    matchers: [
      { type: 'IP-CIDR', value: '100.64.0.0/10', noResolve: true },
      { type: 'IP-CIDR6', value: 'fd7a:115c:a1e0::/48', noResolve: true },
      { type: 'PROCESS-NAME', value: 'Tailscale' },
      {
        type: 'PROCESS-NAME',
        value: 'io.tailscale.ipn.macsys.network-extension',
      },
    ],
  },
  {
    id: 'private-network',
    name: 'NAS 与局域网',
    description: '极空间、路由器和本地设备',
    kind: 'network',
    action: 'DIRECT',
    enabled: true,
    matchers: [
      { type: 'IP-CIDR', value: '10.0.0.0/8', noResolve: true },
      { type: 'IP-CIDR', value: '172.16.0.0/12', noResolve: true },
      { type: 'IP-CIDR', value: '192.168.0.0/16', noResolve: true },
    ],
  },
];

function dataFilePath() {
  const directory = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return {
    directory,
    file: path.join(directory, 'policies.json'),
  };
}

export async function readPolicyStore(): Promise<PolicyStore> {
  const location = dataFilePath();
  try {
    const content = await readFile(/* turbopackIgnore: true */ location.file, 'utf8');
    return validateStore(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const store: PolicyStore = {
      version: 1,
      updatedAt: new Date().toISOString(),
      policies: initialPolicies,
    };
    await writePolicyStore(store);
    return store;
  }
}

export async function writePolicyStore(input: unknown): Promise<PolicyStore> {
  const store = validateStore(input);
  const nextStore: PolicyStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  const location = dataFilePath();
  const temporaryFile = `${location.file}.${process.pid}.tmp`;
  await mkdir(location.directory, { recursive: true });
  await writeFile(temporaryFile, `${JSON.stringify(nextStore, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, location.file);
  return nextStore;
}

export function validateStore(input: unknown): PolicyStore {
  if (!input || typeof input !== 'object') throw new Error('清单格式无效');
  const candidate = input as Partial<PolicyStore>;
  if (!Array.isArray(candidate.policies)) throw new Error('缺少规则清单');
  if (candidate.policies.length > 500) throw new Error('规则数量不能超过 500 条');

  const ids = new Set<string>();
  const policies = candidate.policies.map((policy, index) => {
    if (!policy || typeof policy !== 'object') throw new Error(`第 ${index + 1} 条规则无效`);
    const value = policy as Policy;
    if (!value.id || !/^[a-z0-9-]{1,80}$/.test(value.id)) throw new Error(`第 ${index + 1} 条规则 ID 无效`);
    if (ids.has(value.id)) throw new Error(`规则 ID 重复：${value.id}`);
    ids.add(value.id);
    if (!value.name?.trim() || value.name.length > 80) throw new Error(`第 ${index + 1} 条规则名称无效`);
    if (!['service', 'website', 'app', 'network'].includes(value.kind)) throw new Error(`第 ${index + 1} 条规则类型无效`);
    if (!['DIRECT', 'PROXY'].includes(value.action)) throw new Error(`第 ${index + 1} 条规则决定无效`);
    if (!Array.isArray(value.matchers) || value.matchers.length === 0 || value.matchers.length > 50) throw new Error(`第 ${index + 1} 条规则缺少匹配内容`);
    const matchers = value.matchers.map((matcher) => {
      if (!matcherTypes.has(matcher.type) || !matcher.value?.trim() || matcher.value.length > 255 || /[,\r\n]/.test(matcher.value)) {
        throw new Error(`“${value.name}”包含无效匹配内容`);
      }
      return {
        type: matcher.type,
        value: matcher.value.trim(),
        ...(matcher.noResolve ? { noResolve: true } : {}),
      };
    });
    return {
      id: value.id,
      name: value.name.trim(),
      description: String(value.description || '').trim().slice(0, 160),
      kind: value.kind,
      action: value.action,
      enabled: Boolean(value.enabled),
      matchers,
    } satisfies Policy;
  });

  return {
    version: 1,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    policies,
  };
}

export function policyToYaml(store: PolicyStore, action: PolicyAction) {
  const lines = store.policies
    .filter((policy) => policy.enabled && policy.action === action)
    .flatMap((policy) => [
      `  # ${policy.name}`,
      ...policy.matchers.map((matcher) => {
        const suffix = matcher.noResolve ? ',no-resolve' : '';
        return `  - ${matcher.type},${matcher.value}${suffix}`;
      }),
    ]);
  if (lines.length === 0) {
    return `# 由分流清单自动生成，请勿手动编辑\n# 更新时间：${store.updatedAt}\npayload: []\n`;
  }
  return `# 由分流清单自动生成，请勿手动编辑\n# 更新时间：${store.updatedAt}\npayload:\n${lines.join('\n')}\n`;
}

export function isAuthorized(request: Request) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return true;
  return request.headers.get('x-admin-password') === password;
}
