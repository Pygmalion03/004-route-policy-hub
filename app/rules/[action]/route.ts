import { policyToYaml, readPolicyStore, type PolicyAction } from '@/lib/policies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: RouteContext<'/rules/[action]'>,
) {
  const { action: rawAction } = await context.params;
  const action = rawAction.replace(/\.ya?ml$/i, '').toUpperCase();
  if (!['DIRECT', 'PROXY'].includes(action)) {
    return new Response('Not found', { status: 404 });
  }

  const store = await readPolicyStore();
  return new Response(policyToYaml(store, action as PolicyAction), {
    headers: {
      'content-type': 'application/yaml; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}
