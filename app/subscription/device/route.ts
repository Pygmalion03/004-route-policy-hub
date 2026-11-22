import { generateConfiguration, readConnections } from '@/lib/connections';
import { findDeviceAssignment, recordDeviceDownload } from '@/lib/device-assignments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const noCache = { 'cache-control': 'no-store' };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const platform = url.searchParams.get('platform');
  if (!/^[a-f0-9-]{36}$/.test(key) || !['desktop', 'ios'].includes(platform || '')) return new Response('Unauthorized', { status: 401, headers: noCache });
  const assignment = await findDeviceAssignment(key);
  if (!assignment) return new Response('Unauthorized', { status: 401, headers: noCache });
  try {
    const store = await readConnections();
    if (!store && assignment.plan !== 'direct') return new Response('No configured connection', { status: 409, headers: noCache });
    const config = assignment.plan === 'direct'
      ? { mode: 'rule', 'mixed-port': 7897, 'allow-lan': false, ipv6: true, rules: ['MATCH,DIRECT'] }
      : await generateConfiguration(store!, process.env.PUBLIC_BASE_URL || url.origin,
        assignment.plan === 'flex' ? 'flex' : platform === 'ios' ? 'strict-ios' : 'strict-mac');
    if (platform === 'ios' && assignment.plan === 'flex') delete config.listeners;
    await recordDeviceDownload(assignment);
    return new Response(JSON.stringify(config, null, 2), {
      headers: { ...noCache, 'content-type': 'text/yaml; charset=utf-8', 'profile-update-interval': '1', 'content-disposition': 'attachment; filename="route-device.yaml"' },
    });
  } catch {
    return new Response('Device plan is not ready', { status: 409, headers: noCache });
  }
}
