import { equalSecret, generateConfiguration, readConnections, refreshConnections } from '@/lib/connections';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const store = await readConnections();
  if (!store || !equalSecret(new URL(request.url).searchParams.get('token') || '', store.token)) return new Response('Unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } });
  const origin = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const refreshed = await refreshConnections();
  const client = new URL(request.url).searchParams.get('client') === 'ios' ? 'ios' : 'desktop';
  if (client === 'ios' && !(refreshed || store).claude) return new Response('Claude fixed exit is not configured', { status: 409, headers: { 'cache-control': 'no-store' } });
  const config = await generateConfiguration(refreshed || store, origin, client);
  return new Response(JSON.stringify(config, null, 2), { headers: { 'content-type': 'text/yaml; charset=utf-8', 'cache-control': 'no-store', 'profile-update-interval': '1', 'content-disposition': 'attachment; filename="route-hub.yaml"' } });
}
