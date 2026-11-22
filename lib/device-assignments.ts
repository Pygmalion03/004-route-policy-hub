import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LanDevice } from './lan-devices';

export type DevicePlan = 'flex' | 'strict' | 'direct';
export type DeviceAssignment = {
  mac: string; name: string; key: string; plan: DevicePlan; revision: number;
  downloadedRevision: number | null; downloadedAt: string | null;
  verifiedRevision?: number | null; verifiedAt?: string | null;
};

const filePath = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'device-assignments.json');
let pending: Promise<unknown> = Promise.resolve();

export async function listDeviceAssignments(): Promise<DeviceAssignment[]> {
  try { return JSON.parse(await readFile(/* turbopackIgnore: true */ filePath(), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function findDeviceAssignment(key: string) {
  return (await listDeviceAssignments()).find(assignment => assignment.key === key);
}

function update<T>(change: (assignments: DeviceAssignment[]) => { assignments: DeviceAssignment[]; result: T }): Promise<T> {
  const operation = pending.catch(() => {}).then(async () => {
    const current = await listDeviceAssignments();
    const { assignments, result } = change(current);
    if (assignments !== current) {
      const file = filePath(), temporary = `${file}.${process.pid}.tmp`;
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(assignments, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, file);
    }
    return result;
  });
  pending = operation;
  return operation;
}

export function assignDevice(device: Pick<LanDevice, 'mac' | 'name'>, plan: DevicePlan) {
  return update(current => {
    const previous = current.find(item => item.mac === device.mac);
    if (previous?.plan === plan) return { assignments: current, result: previous };
    const next: DeviceAssignment = {
      mac: device.mac, name: device.name, key: previous?.key || randomUUID(), plan, revision: (previous?.revision || 0) + 1,
      downloadedRevision: previous?.downloadedRevision ?? null, downloadedAt: previous?.downloadedAt ?? null,
      verifiedRevision: previous?.verifiedRevision ?? null, verifiedAt: previous?.verifiedAt ?? null,
    };
    return { assignments: [...current.filter(item => item.mac !== device.mac), next], result: next };
  });
}

export function recordDeviceDownload(observed: DeviceAssignment) {
  return update(current => {
    const matching = current.find(item => item.key === observed.key && item.revision === observed.revision);
    if (!matching || matching.downloadedRevision === observed.revision) return { assignments: current, result: undefined };
    return {
      assignments: current.map(item => item === matching ? { ...item, downloadedRevision: observed.revision, downloadedAt: new Date().toISOString() } : item),
      result: undefined,
    };
  });
}

export class DeviceVerificationConflictError extends Error {}
export class DeviceAssignmentNotFoundError extends Error {}

// Explicit human acknowledgement, not evidence of a live gateway or subscription application.
// Revision check prevents a stale browser tab from validating a newly changed plan.
export function recordDeviceVerification(mac: string, revision: number, verified: boolean) {
  return update(current => {
    const matching = current.find(item => item.mac === mac);
    if (!matching) throw new DeviceAssignmentNotFoundError('该设备尚未分配上网方案');
    if (matching.revision !== revision) throw new DeviceVerificationConflictError('方案已更新，请刷新后重新核验');
    const existing = matching.verifiedRevision === matching.revision;
    if (existing === verified) return { assignments: current, result: matching };
    const next = { ...matching, verifiedRevision: verified ? matching.revision : null, verifiedAt: verified ? new Date().toISOString() : null };
    return { assignments: current.map(item => item.mac === mac ? next : item), result: next };
  });
}

export function devicePlanState(assignment?: DeviceAssignment) {
  return assignment ? {
    plan: assignment.plan,
    fetched: assignment.downloadedRevision === assignment.revision,
    revision: assignment.revision,
    verified: assignment.verifiedRevision === assignment.revision,
    verifiedAt: assignment.verifiedRevision === assignment.revision ? assignment.verifiedAt || null : null,
  } : null;
}
