import { connectionClient, equalSecret, generateConfiguration, isReusableClient, readConnections, refreshConnections } from '@/lib/connections';
import { readPolicyStore } from '@/lib/policies';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = connectionClient(url.searchParams.get('client'));
  if (url.pathname.endsWith('/plan') !== isReusableClient(client)) return new Response('Unknown subscription plan', { status: 404, headers: { 'cache-control': 'no-store' } });
  const store = await readConnections();
  if (!store || !equalSecret(url.searchParams.get('token') || '', store.token)) return new Response('Unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } });
  const origin = process.env.PUBLIC_BASE_URL || url.origin;
  if (client === 'strict-mac' || client === 'strict-ios') {
    const policy = await readPolicyStore();
    if (!store.vpsNodes?.some(node => node.id === policy.strictVpsId)) return new Response('Strict VPS has not been selected', { status: 409, headers: { 'cache-control': 'no-store' } });
  }
  const refreshed = client === 'strict-mac' || client === 'strict-ios' ? store : await refreshConnections();
  if (client === 'mac' && !(refreshed || store).macDefaults) return new Response('Mac default route is not configured', { status: 409, headers: { 'cache-control': 'no-store' } });
  const config = await generateConfiguration(refreshed || store, origin, client);
  return new Response(JSON.stringify(config, null, 2), { headers: { 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store', 'profile-update-interval': '1', 'content-disposition': 'attachment; filename="route-hub.yaml"' } });
}
