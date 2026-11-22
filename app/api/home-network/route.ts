import { connectionAuthorized, readConnections } from '@/lib/connections';
import {
  generateHomeNetwork, homeDraftIssues, HomeDraftConflictError,
  homeNetworkPreview, readHomeDraft, saveHomeDraft, validateHomeDraft,
} from '@/lib/home-network';
import { readPolicyStore } from '@/lib/policies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
const unauthorized = () => Response.json({ error: '请先输入管理密码解锁' }, { status: 401, headers });

export async function GET(request: Request) {
  if (!connectionAuthorized(request)) return unauthorized();
  try {
    const [draft, store, policy] = await Promise.all([readHomeDraft(), readConnections(), readPolicyStore()]);
    const nodes = store?.vpsNodes || [];
    return Response.json({
      status: 'draft-not-applied', draft, policy,
      nodes: nodes.map(node => ({ id: node.id, name: node.name, type: node.node.type })),
      issues: homeDraftIssues(draft, nodes),
    }, { headers });
  } catch {
    return Response.json({ error: '读取家庭网络草稿失败，请检查本地数据文件' }, { status: 500, headers });
  }
}
export async function PUT(request: Request) {
  if (!connectionAuthorized(request)) return unauthorized();
  try {
    const draft = await saveHomeDraft(await request.json());
    return Response.json({ status: 'draft-not-applied', draft }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? '草稿 JSON 格式无效' : error instanceof Error ? error.message : '保存失败' }, {
      status: error instanceof HomeDraftConflictError ? 409 : 400, headers,
    });
  }
}
export async function POST(request: Request) {
  if (!connectionAuthorized(request)) return unauthorized();
  try {
    const input = await request.json();
    if (!input || !['preview', 'download'].includes(input.action)) throw new Error('请选择预览或下载');
    const draft = validateHomeDraft(input.draft), store = await readConnections();
    const bundle = generateHomeNetwork(draft, store?.vpsNodes || [], await readPolicyStore());
    if (input.action === 'preview') return Response.json(homeNetworkPreview(bundle), { headers });
    if (typeof input.file !== 'string' || !Object.hasOwn(bundle.files, input.file)) throw new Error('配置文件不存在');
    return new Response(bundle.files[input.file], {
      headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${input.file}"`, 'x-content-type-options': 'nosniff' },
    });
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? '配置 JSON 格式无效；为保护秘密不显示原始内容' : error instanceof Error ? error.message : '生成失败' }, { status: 400, headers });
  }
}
