/**
 * Orchestrates ONE web change across host interception and router gateway.
 * This is intentionally separate from the transport/privileged implementation.
 * There are no direct router writes here; callers supply narrowly-scoped
 * interfaces and must not expose successful "applied" status until verified.
 */
import type { DevicePlan } from './device-assignments';

export type SingleDevice = { mac: string; ip: string; name: string };
export type PlanActivationResult =
  | { outcome: 'router-direct'; effectivePlan: 'direct'; q4Managed: false }
  | { outcome: 'awaiting-reconnect'; effectivePlan: DevicePlan; q4Managed: true };

export type ActivationAgent = {
  prepareQ4: (device: SingleDevice) => Promise<string>;
  bindRouterToQ4: (device: SingleDevice) => Promise<void>;
  activateQ4Plan: (ticket: string, plan: DevicePlan) => Promise<void>;
  abortQ4: (ticket: string) => Promise<void>;
  restoreRouter: (device: SingleDevice) => Promise<void>;
};

export class ActivationRollbackError extends Error {}

export async function activateFromSingleWebChange(
  device: SingleDevice,
  plan: DevicePlan,
  agent: ActivationAgent,
): Promise<PlanActivationResult> {
  // A new client uses the ZTE DHCP gateway until the first actual Q4 takeover.
  // The default-direct selection itself must not reconfigure the network.
  if (plan === 'direct') {
    return { outcome: 'router-direct', effectivePlan: 'direct', q4Managed: false };
  }
  let ticket: string | null = null;
  let routerAttempted = false;
  try {
    // The host is prepared FIRST: never point a client at a gateway that is
    // not already ready to intercept and protect its traffic.
    ticket = await agent.prepareQ4(device);
    if (!ticket || ticket.length > 128) throw new Error('Q4 准备票据无效');
    // Even a failed HTTP reply may follow a successful router mutation.
    // A driver must implement restoreRouter as ownership-checked, idempotent.
    routerAttempted = true;
    await agent.bindRouterToQ4(device);
    await agent.activateQ4Plan(ticket, plan);
    // The DHCP lease may still hold the ZTE gateway until Wi-Fi reconnects.
    // Do not report "active" before observing Q4 traffic from the device.
    return { outcome: 'awaiting-reconnect', effectivePlan: plan, q4Managed: true };
  } catch (error) {
    let reverted = true;
    if (routerAttempted) {
      try { await agent.restoreRouter(device); }
      catch { reverted = false; }
    }
    if (ticket) {
      try { await agent.abortQ4(ticket); }
      catch { reverted = false; }
    }
    if (!reverted) {
      throw new ActivationRollbackError(
        'Q4/中兴自动接入失败且未确认全部恢复；请勿继续操作其他设备，原设备可能需要重连 Wi-Fi',
      );
    }
    throw error;
  }
}
