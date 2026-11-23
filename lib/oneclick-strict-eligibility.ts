import type { StrictReadiness } from './q4-oneclick-agent';

/** A valid Q4 host attestation and an exact router Wi-Fi interface are BOTH required. */
export function strictEligibility(
  host: StrictReadiness,
  expectedWifiInterface: string | undefined,
  observedWifiInterface: string | undefined,
): StrictReadiness {
  if (!host.available) return {
    available: false,
    reason: host.reason || 'Q4 尚未验证专用 Wi-Fi 的严格 LA 防绕行能力',
  };
  if (!expectedWifiInterface || observedWifiInterface !== expectedWifiInterface) return {
    available: false,
    reason: '中兴未确认此设备连接已验收的专用 Wi-Fi，LA 保持禁用',
  };
  return { available: true, reason: null };
}
