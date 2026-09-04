import {
  isAuthorized,
  PolicyStoreConflictError,
  readPolicyStore,
  savePolicyStore,
} from '@/lib/policies';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = await readPolicyStore();
    return Response.json(
      {
        ...store,
        requiresPassword: Boolean(process.env.ADMIN_PASSWORD),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
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
    const store = await savePolicyStore(await request.json());
    return Response.json(store);
  } catch (error) {
    if (error instanceof PolicyStoreConflictError) {
      return Response.json(
        {
          ...error.currentStore,
          error: '另一台设备刚刚修改了清单，已返回最新版本',
        },
        { status: 409 },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : '保存清单失败' },
      { status: 400 },
    );
  }
}
