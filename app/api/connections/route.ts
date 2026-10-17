import { connectionAuthorized, publicConnections, readConnections, saveConnections } from '@/lib/connections';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
export async function GET(request: Request) {
  if (!connectionAuthorized(request)) return Response.json({ error: '请先解锁编辑' }, { status: 401, headers });
  try { return Response.json(publicConnections(await readConnections()), { headers }); }
  catch { return Response.json({ error: '读取连接配置失败' }, { status: 500, headers }); }
}
export async function PUT(request: Request) {
  if (!connectionAuthorized(request)) return Response.json({ error: '请先解锁编辑' }, { status: 401, headers });
  try { return Response.json(publicConnections(await saveConnections(await request.json())), { headers }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : '保存失败' }, { status: 400, headers }); }
}
export async function POST(request: Request) {
  if (!connectionAuthorized(request)) return Response.json({ error: '请先解锁编辑' }, { status: 401, headers });
  const store = await readConnections();
  if (!store) return Response.json({ error: '尚未配置' }, { status: 409, headers });
  const origin = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
  return Response.json({ url: `${origin}/subscription?token=${store.token}` }, { headers });
}
