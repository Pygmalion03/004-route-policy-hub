import { connectionAuthorized } from '@/lib/connections';
import { devicePlanState, listDeviceAssignments } from '@/lib/device-assignments';
import { applyRuntimePlan, getRuntimeStatuses } from '@/lib/device-runtime-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
const fail = (error: string, status: number) => Response.json({ error }, { headers, status });

// This endpoint never issues shell commands or changes Q4 networking directly.
// A separate preinstalled host controller owns the only permitted Magic8 service operation.
export async function POST(request: Request) {
  if (!connectionAuthorized(request)) return fail('请先解锁设备管理页面', 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('提交的请求不是有效 JSON', 400);
  }
  if (!body || typeof body !== 'object') return fail('设备及方案版本无效', 400);
  const { mac, revision } = body as Record<string, unknown>;
  if (typeof mac !== 'string' || !/^(?:[\da-f]{2}:){5}[\da-f]{2}$/.test(mac) ||
    !Number.isSafeInteger(revision) || (revision as number) < 1) {
    return fail('设备及方案版本无效', 400);
  }
  try {
    const assignment = (await listDeviceAssignments()).find(item => item.mac === mac);
    if (!assignment) return fail('请先为设备保存上网方案', 404);
    if (assignment.revision !== revision) return fail('该方案已被其他页面更新，请刷新后重新操作', 409);
    const controllers = await getRuntimeStatuses();
    if (!controllers.some(controller => controller.available && controller.managedMac === mac))
      return fail('该设备尚未被授权实际切换。为防影响其他设备，不能下发。', 403);
    // Target plan is derived from authenticated server-side assignment, never a browser-supplied value.
    const applied = await applyRuntimePlan(mac, assignment.revision, assignment.plan);
    return Response.json({ selection: devicePlanState(assignment), applied }, { headers });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Q4 控制器操作失败', 503);
  }
}
