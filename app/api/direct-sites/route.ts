import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import {
  PolicyStoreConflictError,
  readPolicyStore,
  savePolicyStore,
  type Policy,
} from '@/lib/policies';
import { connectionAuthorized } from '@/lib/connections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
const isSite = (p: Policy) =>
  p.enabled &&
  p.action === 'DIRECT' &&
  p.kind === 'website' &&
  p.matchers.every((m) => m.type === 'DOMAIN-SUFFIX');
const view = (store: Awaited<ReturnType<typeof readPolicyStore>>) => ({
  updatedAt: store.updatedAt,
  uuDirect: store.policies.some(
    (p) => p.id === 'uu-remote' && p.enabled && p.action === 'DIRECT',
  ),
  sites: store.policies
    .filter(isSite)
    .map((p) => ({ id: p.id, domain: p.matchers[0].value })),
});
export async function GET() {
  return Response.json(view(await readPolicyStore()), { headers });
}
async function update(request: Request, remove: boolean) {
  if (!connectionAuthorized(request))
    return Response.json({ error: '请先解锁管理' }, { status: 401, headers });
  try {
    const input = await request.json(),
      store = await readPolicyStore();
    if (input.updatedAt !== store.updatedAt)
      throw new PolicyStoreConflictError(store);
    if (remove) {
      if (!store.policies.some((p) => p.id === input.id && isSite(p)))
        throw new Error('未找到这条直连网站');
      store.policies = store.policies.filter((p) => p.id !== input.id);
    } else if (input.application === 'uu-remote') {
      const policy = store.policies.find((p) => p.id === 'uu-remote');
      if (!policy) throw new Error('未找到 UU 远程应用规则');
      policy.enabled = true;
      policy.action = 'DIRECT';
    } else {
      const raw = String(input.domain || '').trim();
      let url: URL;
      try {
        url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      } catch {
        throw new Error('请填写有效的网站域名');
      }
      const domain = url.hostname.toLowerCase().replace(/\.$/, '');
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        isIP(domain) ||
        domain.length > 253 ||
        !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
      )
        throw new Error('请填写网站域名，例如 bilibili.com');
      if (
        store.policies.some(
          (p) => isSite(p) && p.matchers.some((m) => m.value === domain),
        )
      )
        throw new Error('该网站已在直连清单中');
      store.policies.push({
        id: randomUUID(),
        name: domain,
        kind: 'website',
        description: '日常上网的直连例外',
        enabled: true,
        action: 'DIRECT',
        matchers: [{ type: 'DOMAIN-SUFFIX', value: domain }],
      });
    }
    return Response.json(view(await savePolicyStore(store)), { headers });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : '保存失败' },
      { status: e instanceof PolicyStoreConflictError ? 409 : 400, headers },
    );
  }
}
export async function POST(request: Request) {
  return update(request, false);
}
export async function DELETE(request: Request) {
  return update(request, true);
}
