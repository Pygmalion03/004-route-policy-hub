// Private root-controller transport for the one-click device flow.
// The host service owns all routing writes. Enable only after its bounded
// implementation and private network configuration have been installed.
import { createConnection, isIP } from 'node:net';
import path from 'node:path';
import type { DevicePlan } from './device-assignments';
import type { ActivationAgent, SingleDevice } from './one-click-device-activation';
import { createZteBindingTransaction } from './zte-oneclick-binding';
import { isAllowedOneClickIp, readOneClickNetworkConfig, type OneClickNetworkConfig } from './oneclick-network-config';

type HostReply = { ok: boolean; ticket?: string; error?: string; states?: unknown; strict?: unknown };
type HostMessage =
  | { op: 'prepare'; mac: string; ip: string; plan: 'direct' }
  | { op: 'activate'; ticket: string; plan: DevicePlan }
  | { op: 'abort'; ticket: string }
  | { op: 'status' }
  | { op: 'change'; mac: string; ip: string; plan: DevicePlan };

function hostSocket() {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), '.rph-oneclick-control.sock');
}
async function callHost(req: HostMessage): Promise<HostReply> {
  return new Promise((resolve,reject)=>{
    const socket=createConnection({path:hostSocket()});
    let completed=false,buf='';
    const finish=(err?:Error,ok?:HostReply)=>{
      if(completed)return;
      completed=true;
      socket.destroy();
      if(err)reject(err);
      else if(ok)resolve(ok);
      else reject(new Error('Q4 设备接入控制器无响应'));
    };
    socket.setTimeout(7000,()=>finish(new Error('Q4 自动接入控制器超时')));
    socket.on('error',()=>finish(new Error('Q4 自动接入控制器未安装或不可用')));
    socket.on('connect',()=>socket.write(JSON.stringify(req)+'\n'));
    socket.on('data',chunk=>{
      buf+=chunk.toString();
      if(Buffer.byteLength(buf,'utf8')>32768)return finish(new Error('Q4 自动接入控制器响应过大'));
      const end=buf.indexOf('\n');
      if(end<0)return;
      try{
        const payload:unknown=JSON.parse(buf.slice(0,end));
        if(!payload || typeof payload!=='object' ||
          typeof (payload as HostReply).ok!=='boolean')throw Error('invalid');
        const reply=payload as HostReply;
        if(!reply.ok)return finish(new Error(reply.error?.slice(0,100)||'Q4 设备接入被拒绝'));
        finish(undefined,reply);
      } catch(err) {
        finish(err instanceof Error ? err : new Error('Q4 自动接入响应无效'));
      }
    });
    socket.on('end',()=>finish(new Error('Q4 设备接入控制器提前关闭')));
  });
}

export type OneClickState = {
  managedMac: string;
  managedIp: string;
  activePlan: DevicePlan;
  status: 'active' | 'unknown';
  appliedRevision: null;
  appliedAt: string | null;
  reason: string | null;
  phase: 'prepared' | 'active' | 'fallback-direct';
};

export type StrictReadiness = { available: boolean; reason: string | null };
export type OneClickSnapshot = {
  available: boolean;
  states: OneClickState[];
  reason: string | null;
  // Only the privileged Q4 controller can attest to network-level strict isolation.
  strict: StrictReadiness;
};

const STRICT_UNVERIFIED: StrictReadiness = {
  available: false,
  reason: '专用 Wi-Fi 的 DNS、IPv6 与线路故障防绕行尚未验收',
};

function parseStrictReadiness(value: unknown): StrictReadiness {
  if (value === undefined) return STRICT_UNVERIFIED; // Old Q4 controller: fail closed.
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Q4 严格出口能力响应无效');
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).sort().join(',') !== 'available,reason' ||
      typeof candidate.available !== 'boolean' ||
      !(candidate.reason === null || (typeof candidate.reason === 'string' && candidate.reason.length <= 180)) ||
      (candidate.available && candidate.reason !== null)) {
    throw new Error('Q4 严格出口能力响应无效');
  }
  return { available: candidate.available, reason: candidate.reason as string | null };
}

function validateOneClickState(value: unknown): OneClickState {
  if (!value || typeof value !== 'object') throw new Error('控制器状态格式无效');
  const state = value as Partial<OneClickState>;
  if (typeof state.managedMac !== 'string' ||
    !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(state.managedMac) ||
    typeof state.managedIp !== 'string' || isIP(state.managedIp) !== 4 ||
    !['direct', 'flex', 'strict'].includes(state.activePlan || '') ||
    !['prepared', 'active', 'fallback-direct'].includes(state.phase || '') ||
    (state.status !== 'unknown' && state.status !== 'active') ||
    state.appliedRevision !== null ||
    (state.appliedAt !== null && typeof state.appliedAt !== 'string') ||
    (state.reason !== null && typeof state.reason !== 'string')) {
    throw new Error('控制器状态格式无效');
  }
  return {
    managedMac: state.managedMac, managedIp: state.managedIp,
    activePlan: state.activePlan!, status: state.status,
    appliedRevision: null, appliedAt: state.appliedAt!, reason: state.reason!,
    phase: state.phase!,
  };
}

export async function getOneClickSnapshot(): Promise<OneClickSnapshot> {
  if (process.env.RPH_ONECLICK_ENABLED !== '1') {
    return { available: false, states: [], reason: '自动接入控制器未启用', strict: STRICT_UNVERIFIED };
  }
  try {
    const result = await callHost({ op: 'status' });
    if (!Array.isArray(result.states) || result.states.length > 12) throw new Error('无效状态列表');
    const states = result.states.map(validateOneClickState);
    if (new Set(states.map(state => state.managedMac)).size !== states.length ||
      new Set(states.map(state => state.managedIp)).size !== states.length) throw new Error('设备身份冲突');
    // A malformed optional strict claim must disable LA, not SG or DIRECT.
    let strict = STRICT_UNVERIFIED;
    try { strict = parseStrictReadiness(result.strict); } catch { /* strict remains unavailable */ }
    return { available: true, states, reason: null, strict };
  } catch {
    return { available: false, states: [], reason: '自动接入控制器暂不可用，请稍后刷新', strict: STRICT_UNVERIFIED };
  }
}

// Compatibility reader; capability decisions must use getOneClickSnapshot().
export async function getOneClickStates(): Promise<OneClickState[]> {
  return (await getOneClickSnapshot()).states;
}

export async function changeOneClickPlan(mac:string,ip:string,plan:DevicePlan) {
  if(process.env.RPH_ONECLICK_ENABLED!=='1')
    throw new Error('Q4 自动接入控制器未启用');
  const config=await readOneClickNetworkConfig();
  if(!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) || !isAllowedOneClickIp(ip,config) ||
    !['direct','flex','strict'].includes(plan))
    throw new Error('设备或目标线路不符合 Q4 授权规则');
  await callHost({op:'change',mac,ip,plan});
}

export function createOneClickAgent(network: OneClickNetworkConfig): ActivationAgent {
  if (process.env.RPH_ONECLICK_ENABLED !== '1') {
    throw new Error('Q4 新设备一键接入尚未完成部署；本次没有修改设备线路');
  }
  const config = { ...network, reservedIps: [...network.reservedIps] };
  const binding = createZteBindingTransaction(config);
  return {
    prepareQ4: async (device:SingleDevice)=>{
      if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(device.mac) ||
        !isAllowedOneClickIp(device.ip, config)) throw new Error('设备 MAC/IP 不在受控许可范围');
      const result=await callHost({op:'prepare',mac:device.mac,ip:device.ip,plan:'direct'});
      if(!result.ticket || !/^[a-f0-9]{32}$/.test(result.ticket))
        throw new Error('Q4 未返回有效的接入授权票据');
      return result.ticket;
    },
    bindRouterToQ4: binding.bindRouterToQ4,
    activateQ4Plan: async(ticket,plan)=>{
      await callHost({op:'activate',ticket,plan});
    },
    abortQ4: async ticket=>{
      await callHost({op:'abort',ticket});
    },
    restoreRouter: binding.restoreRouter,
  };
}