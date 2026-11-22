// Private, bounded Unix-socket bridge to the separately installed Q4 host controller.
// This process has no NET_ADMIN capability and cannot change host routing itself.
import { createConnection } from 'node:net';
import path from 'node:path';
import type { DevicePlan } from './device-assignments';

export type RuntimeState = {
  available: true;
  managedMac: string;
  managedIp: string;
  activePlan: DevicePlan | null;
  appliedRevision: number | null;
  appliedAt: string | null;
  status: 'active' | 'unknown' | 'failed';
  reason: string | null;
};
export type RuntimeAvailability =
  | RuntimeState
  | { available: false; reason: string };

type WireRequest = { op: 'status' } | {
  op: 'apply'; mac: string; revision: number; plan: DevicePlan;
};
type WireResponse = {
  ok: boolean;
  error?: string;
  state?: unknown;
  states?: unknown;
};

const MAC_PATTERN = /^(?:[\da-f]{2}:){5}[\da-f]{2}$/;
const plans: DevicePlan[] = ['flex', 'strict', 'direct'];

export type ControllerKind = 'magic8' | 'shared';
function socketPath(kind: ControllerKind = 'magic8') {
  // Socket is on the existing private host-backed DATA_DIR volume; no new exposed TCP listener.
  const name = kind === 'magic8' ? '.rph-magic8-control.sock' : '.rph-home-control.sock';
  return path.join(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(process.cwd(), 'data'), name);
}

export function validateRuntimeState(value: unknown): RuntimeState {
  if (!value || typeof value !== 'object') throw new Error('Q4 控制器返回无效状态');
  const v = value as Record<string, unknown>;
  if (typeof v.managedMac !== 'string' || !MAC_PATTERN.test(v.managedMac) ||
    typeof v.managedIp !== 'string' ||
    (v.activePlan !== null && !plans.includes(v.activePlan as DevicePlan)) ||
    (v.appliedRevision !== null && (!Number.isSafeInteger(v.appliedRevision) || (v.appliedRevision as number) < 1)) ||
    (v.appliedAt !== null && typeof v.appliedAt !== 'string') ||
    !['active', 'unknown', 'failed'].includes(v.status as string) ||
    (v.reason !== null && typeof v.reason !== 'string')) {
    throw new Error('Q4 控制器状态格式不匹配');
  }
  return {
    available: true,
    managedMac: v.managedMac,
    managedIp: v.managedIp,
    activePlan: v.activePlan as DevicePlan | null,
    appliedRevision: v.appliedRevision as number | null,
    appliedAt: v.appliedAt as string | null,
    status: v.status as RuntimeState['status'],
    reason: v.reason as string | null,
  };
}

function talk(request: WireRequest, timeout: number, kind: ControllerKind = 'magic8'): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath(kind) });
    let buffer = '';
    let finished = false;
    const done = (error?: Error, result?: WireResponse) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error('Q4 控制器未返回结果'));
    };
    socket.setTimeout(timeout, () => done(new Error('Q4 控制器响应超时')));
    socket.on('error', () => done(new Error('Q4 控制器未连接')));
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 8192) return done(new Error('Q4 控制器响应过长'));
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        const payload: unknown = JSON.parse(buffer.slice(0, end));
        if (!payload || typeof payload !== 'object' || typeof (payload as WireResponse).ok !== 'boolean') {
          throw new Error('Q4 控制器返回格式错误');
        }
        done(undefined, payload as WireResponse);
      } catch {
        done(new Error('Q4 控制器响应无法识别'));
      }
    });
    socket.on('end', () => done(new Error('Q4 控制器连接提前关闭')));
  });
}

export async function getRuntimeStatus(kind: ControllerKind = 'magic8'): Promise<RuntimeAvailability> {
  try {
    const response = await talk({ op: 'status' }, 2000, kind);
    if (!response.ok) throw new Error('Q4 控制器状态不可用');
    return validateRuntimeState(response.state);
  } catch {
    return { available: false, reason: '宿主机控制器未连接；当前只能保存计划，不能实际应用线路。' };
  }
}

export async function getRuntimeStatuses(): Promise<RuntimeAvailability[]> {
  try {
    const response = await talk({ op: 'status' }, 2500, 'shared');
    if (!response.ok || !Array.isArray(response.states) || response.states.length !== 2)
      throw new Error('共享控制器状态无效');
    const states = response.states.map(validateRuntimeState);
    if (states[0].managedMac === states[1].managedMac) throw new Error('设备绑定冲突');
    return states;
  } catch {
    // The previously deployed Magic8-only version remains functional
    // until the Q4 shared-core migration has passed all its checks.
    return [await getRuntimeStatus('magic8')];
  }
}

export async function applyRuntimePlan(mac: string, revision: number, plan: DevicePlan): Promise<RuntimeState> {
  if (!MAC_PATTERN.test(mac) || !Number.isSafeInteger(revision) || revision < 1 || !plans.includes(plan)) {
    throw new Error('设备、方案版本或目标线路无效');
  }
  const controllers = await getRuntimeStatuses();
  const index = controllers.findIndex(item => item.available && item.managedMac === mac);
  if (index < 0) throw new Error('该设备尚未安装或授权 Q4 实际控制');
  const status = controllers[index];
  if (!status.available) throw new Error(status.reason);
  if (status.status === 'failed') throw new Error(status.reason || 'Q4 控制器处于异常状态');
  const kind: ControllerKind = controllers.length === 2 ? 'shared' : 'magic8';
  const response = await talk({ op: 'apply', mac, revision, plan }, 45000, kind);
  if (!response.ok) {
    // Server must send only public Chinese descriptions (never raw secrets/logs).
    throw new Error(typeof response.error === 'string' ? response.error.slice(0, 160) : 'Q4 实际切换失败');
  }
  const next = validateRuntimeState(response.state);
  if (next.managedMac !== mac || next.status !== 'active' || next.activePlan !== plan || next.appliedRevision !== revision) {
    throw new Error('Q4 未确认目标线路生效，不能标记已应用');
  }
  return next;
}
