import {
  isAuthorized,
  readPolicyStore,
  writePolicyStore,
} from '@/lib/policies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = await readPolicyStore();
    return Response.json({
      ...store,
      requiresPassword: Boolean(process.env.ADMIN_PASSWORD),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '读取清单失败' },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: '管理密码不正确' }, { status: 401 });
  }

  try {
    const store = await writePolicyStore(await request.json());
    return Response.json(store);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : '保存清单失败' },
      { status: 400 },
    );
  }
}
