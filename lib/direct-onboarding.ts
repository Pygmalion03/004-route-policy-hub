// Validate a device selected on the webpage before automatic enrollment.
// This function only checks router evidence; it never modifies network state.
import { isAllowedOneClickIp, type OneClickNetworkConfig } from './oneclick-network-config';
import type { LanDevice, LanSnapshot } from './lan-devices';

export type DirectOnboardingEvidence = 'router-interface' | 'explicit-web-selection';
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/;

export function validateDirectCandidate(
  snapshot: LanSnapshot,
  mac: string,
  expectedIp: string,
  controlledMacs: ReadonlySet<string>,
  explicitWebSelection: boolean,
  config: OneClickNetworkConfig,
): { device: LanDevice; evidence: DirectOnboardingEvidence } {
  const observedAt = snapshot.observedAt ? Date.parse(snapshot.observedAt) : Number.NaN;
  const now = Date.now();
  if (snapshot.status !== 'live' || !Number.isFinite(observedAt) ||
    observedAt > now || now - observedAt > 60_000) {
    throw new Error('中兴设备名单不新鲜，请刷新后再申请');
  }
  if (!MAC.test(mac) || !isAllowedOneClickIp(expectedIp, config)) {
    throw new Error('申请的设备 MAC 或 IPv4 不在允许接入范围');
  }
  if (!explicitWebSelection) throw new Error('没有明确选择这台设备，拒绝更改它的网络');
  if (controlledMacs.has(mac)) throw new Error('该设备已由现有 Q4 控制器管理，不能再次登记');
  const device = snapshot.devices.find(row => row.mac === mac);
  if (!device || device.online !== true || device.ip !== expectedIp || device.link === '有线') {
    throw new Error('中兴没有确认这台设备当前在线、使用相同 IPv4 且不是有线');
  }
  if (snapshot.devices.some(row => row.mac !== mac && row.ip === expectedIp)) {
    throw new Error('中兴设备表存在 IPv4 冲突，禁止登记');
  }
  if (device.wifiInterfaceAlias && device.wifiInterfaceAlias !== config.wifiInterfaceAlias) {
    throw new Error('中兴明确报告这台设备不在专用 Wi-Fi 接口');
  }
  return {
    device,
    evidence: device.wifiInterfaceAlias === config.wifiInterfaceAlias
      ? 'router-interface' : 'explicit-web-selection',
  };
}
