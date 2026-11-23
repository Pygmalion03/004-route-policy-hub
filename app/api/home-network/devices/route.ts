import { connectionAuthorized, readConnections } from '@/lib/connections';
import { assignDevice, DeviceAssignmentNotFoundError, DeviceVerificationConflictError, devicePlanState, listDeviceAssignments, recordDeviceVerification, type DevicePlan } from '@/lib/device-assignments';
import { getLanSnapshot } from '@/lib/lan-devices';
import { getRuntimeStatuses } from '@/lib/device-runtime-control';
import { getOneClickSnapshot } from '@/lib/q4-oneclick-agent';
import { validateDirectCandidate } from '@/lib/direct-onboarding';
import { isAllowedOneClickIp, readOneClickNetworkConfig } from '@/lib/oneclick-network-config';
import { strictEligibility } from '@/lib/oneclick-strict-eligibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'cache-control': 'no-store' };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function GET(request: Request) {
  if (!connectionAuthorized(request)) return fail('请先解锁设备列表', 401);
  try {
    const [snapshot, assignments, controllers, oneClickSnapshot, network] = await Promise.all([
      getLanSnapshot(), listDeviceAssignments(), getRuntimeStatuses(), getOneClickSnapshot(),
      process.env.RPH_ONECLICK_ENABLED === '1' ? readOneClickNetworkConfig().catch(() => null) : Promise.resolve(null),
    ]);
    const oneClick = oneClickSnapshot.states;
    const controller = controllers[0];
    const allControllers = [
      ...controllers,
      ...oneClick.map(state => ({
        available: true as const, ...state,
        reason: state.phase === 'fallback-direct'
          ? '首次自动接入未完成，Q4 规则已回退直连；仍可在网页选择 SG 重试'
          : state.phase === 'prepared'
            ? 'Q4 已准备接入防护，等待路由器确认'
            : state.reason,
      })),
    ];
    const current = new Map(snapshot.devices.map(device => [device.mac, device]));
    // Only expose a host-authorized pilot as a historical row when the router has no record.
    // It remains online=null, never a fabricated connected device.
    for (const [i, host] of controllers.entries()) {
      if (host.available && !current.has(host.managedMac)) {
        current.set(host.managedMac, {
          mac: host.managedMac,
          name: i === 0 ? '已管理的无线设备' : '已管理的有线设备',
          ip: host.managedIp, online: null, link: '网关已管理',
        });
      }
    }
    for (const host of oneClick) {
      if (!current.has(host.managedMac)) current.set(host.managedMac, {
        mac: host.managedMac, name: '已登记 Q4 的无线设备',
        ip: host.managedIp, online: null, link: '网关已管理',
      });
    }
    for (const item of assignments) {
      if (!current.has(item.mac)) current.set(item.mac, { mac: item.mac, name: item.name, ip: '', online: null, link: '' });
    }
    const controlledMacs = new Set(allControllers.filter(host => host.available).map(host => host.managedMac));
    const strictStatus = (device: typeof snapshot.devices[number]) =>
      strictEligibility(oneClickSnapshot.strict, network?.wifiInterfaceAlias, device.wifiInterfaceAlias);
    const capabilities = (device: typeof snapshot.devices[number]) => {
      const legacy = controllers.find(host => host.available && host.managedMac === device.mac);
      if (legacy?.available) return {
        canSwitch: legacy.status !== 'failed', canEnroll: false, supportsStrict: true, strictReason: null,
        reason: legacy.status === 'failed' ? '网关状态异常，请查看详情' : null,
      };
      const dynamic = oneClick.find(host => host.managedMac === device.mac);
      if (!network || !oneClickSnapshot.available) return {
        canSwitch: false, canEnroll: false, supportsStrict: false,
        strictReason: strictStatus(device).reason,
        reason: !network ? '自动接入配置暂不可用' : oneClickSnapshot.reason,
      };
      if (dynamic && !isAllowedOneClickIp(dynamic.managedIp, network)) return {
        canSwitch: false, canEnroll: false, supportsStrict: false,
        strictReason: '设备不在允许的网关管理范围',
        reason: '此设备不在当前允许管理的网络范围',
      };
      if (dynamic?.phase === 'active') return {
        canSwitch: true, canEnroll: false,
        supportsStrict: strictStatus(device).available,
        strictReason: strictStatus(device).reason, reason: null,
      };
      try {
        // Prepared/fallback entries must re-qualify before an enrollment retry.
        const protectedMacs = new Set(controlledMacs);
        if (dynamic) protectedMacs.delete(dynamic.managedMac);
        validateDirectCandidate(snapshot, device.mac, device.ip, protectedMacs, true, network);
        return { canSwitch: true, canEnroll: !dynamic,
          supportsStrict: strictStatus(device).available,
          strictReason: strictStatus(device).reason, reason: null };
      } catch {
        const reason = device.online !== true ? '设备在线后可重新检查' :
          /有线|ethernet/i.test(device.link) ? '保持现有有线网络' :
          device.wifiInterfaceAlias && device.wifiInterfaceAlias !== network.wifiInterfaceAlias ? '连接专用 Wi-Fi 后可切换' :
          '此设备暂不支持自动接入';
        return { canSwitch: false, canEnroll: false, supportsStrict: false,
          strictReason: strictStatus(device).reason, reason };
      }
    };
    return Response.json({
      autoEnrollmentConfigured: Boolean(network),
      autoEnrollmentAvailable: Boolean(network) && oneClickSnapshot.available,
      oneClickController: { available: oneClickSnapshot.available, reason: oneClickSnapshot.reason },
      status: snapshot.status, observedAt: snapshot.observedAt, controller,
      controllers: allControllers,
      autoManagedMacs: oneClick.map(state => state.managedMac),
      devices: [...current.values()].map(device => ({
        ...device,
        capabilities: capabilities(device),
        selection: devicePlanState(assignments.find(item => item.mac === device.mac)),
        // No saved policy does NOT imply the device is routed through Q4.
        // With ZTE DHCP unchanged, unknown new devices remain router-direct.
        initialDefaultPlan: 'direct' as const,
        oneClickPhase: oneClick.find(item => item.managedMac === device.mac)?.phase || null,
      })),
    }, { headers });
  } catch {
    return fail('读取设备分配失败', 500);
  }
}

export async function PUT(request: Request) {
  if (!connectionAuthorized(request)) return fail('请先解锁设备列表', 401);
  try {
    const { mac, plan } = await request.json();
    if (typeof mac !== 'string' || !['flex', 'strict', 'direct'].includes(plan)) return fail('设备或方案无效', 400);
    const [snapshot, assignments, controllers] = await Promise.all([getLanSnapshot(), listDeviceAssignments(), getRuntimeStatuses()]);
    const device = snapshot.devices.find(item => item.mac === mac) || assignments.find(item => item.mac === mac) ||
      controllers.map((host,i) => host.available && host.managedMac === mac
        ? { mac, name: i === 0 ? '已管理的无线设备' : '已管理的有线设备' } : undefined).find(Boolean);
    if (!device) return fail('未在中兴名单中找到该设备，请刷新', 404);
    return Response.json({ selection: devicePlanState(await assignDevice(device, plan as DevicePlan)) }, { headers });
  } catch {
    return fail('保存设备方案失败', 400);
  }
}

// Manual verification acknowledges a user's actual test; it never changes router, DNS, or proxy settings.
export async function PATCH(request: Request) {
  if (!connectionAuthorized(request)) return fail('请先解锁设备列表', 401);
  try {
    const { mac, revision, verified } = await request.json();
    if (typeof mac !== 'string' || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) ||
        !Number.isSafeInteger(revision) || revision < 1 || typeof verified !== 'boolean') {
      return fail('设备、方案版本或验收状态无效', 400);
    }
    const result = await recordDeviceVerification(mac, revision, verified);
    return Response.json({ selection: devicePlanState(result) }, { headers });
  } catch (error) {
    if (error instanceof DeviceVerificationConflictError) return fail('方案已变化，请刷新设备列表后重新核验', 409);
    if (error instanceof DeviceAssignmentNotFoundError) return fail('该设备尚未分配方案', 404);
    return fail('记录人工验收失败', 400);
  }
}

export async function POST(request: Request) {
  if (!connectionAuthorized(request)) return fail('请先解锁设备列表', 401);
  try {
    const { mac, platform } = await request.json();
    if (typeof mac !== 'string' || !['desktop', 'ios'].includes(platform)) return fail('设备或客户端无效', 400);
    const assignment = (await listDeviceAssignments()).find(item => item.mac === mac);
    if (!assignment) return fail('请先为设备选择方案', 409);
    if (!await readConnections()) return fail('请先在线路管理中配置订阅', 409);
    return Response.json({ path: `/subscription/device?${new URLSearchParams({ key: assignment.key, platform })}` }, { headers });
  } catch {
    return fail('生成设备订阅地址失败', 400);
  }
}