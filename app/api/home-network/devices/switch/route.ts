// One user selection -> prepare Q4 -> write EXACT ZTE device gateway -> switch
// shared Mihomo policy. Never reports applied before actual device traffic proves it.
import { connectionAuthorized } from '@/lib/connections';
import { assignDevice, devicePlanState, type DevicePlan } from '@/lib/device-assignments';
import { getLanSnapshot } from '@/lib/lan-devices';
import { getRuntimeStatuses } from '@/lib/device-runtime-control';
import { validateDirectCandidate } from '@/lib/direct-onboarding';
import { activateFromSingleWebChange } from '@/lib/one-click-device-activation';
import { changeOneClickPlan, createOneClickAgent, getOneClickSnapshot } from '@/lib/q4-oneclick-agent';
import { serializeZteSession, withZteLogin } from '@/lib/zte-router-admin';
import { parseZteBindings } from '@/lib/zte-oneclick-binding';
import { readOneClickNetworkConfig } from '@/lib/oneclick-network-config';
import { strictEligibility } from '@/lib/oneclick-strict-eligibility';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
const fail=(error:string,status:number)=>Response.json({error},{status,headers});

// Deployment-only read canary: same authenticated Q4 Web process, no router
// writes. Never returns MACs, IPs, router credentials, cookies or login token.
export async function GET(request:Request) {
  if(!connectionAuthorized(request))return fail('请先解锁设备管理页面',401);
  if(process.env.RPH_ONECLICK_ENABLED!=='1')
    return fail('新设备一键接入尚未启用',503);
  try {
    const entries=await serializeZteSession(()=>withZteLogin(async req=>{
      const xml=await req('vueData','static_bindAddr_data',{_:String(Date.now())});
      return parseZteBindings(xml);
    }));
    return Response.json({ok:true,existingBindingCount:entries.length,writeOperations:0},{headers});
  } catch {
    return fail('中兴绑定接口未通过带认证的只读预检，未允许自动写入',503);
  }
}

export async function POST(request:Request) {
  if(!connectionAuthorized(request))return fail('请先解锁设备管理页面',401);
  let input:unknown;
  try {input=await request.json();} catch {return fail('设备切换请求不是 JSON',400);}
  if (!input || typeof input!=='object' || Array.isArray(input))
    return fail('设备切换请求无效',400);
  const body=input as Record<string,unknown>;
  if(Object.keys(body).sort().join(',')!=='mac,plan' ||
    typeof body.mac!=='string' || typeof body.plan!=='string' ||
    !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(body.mac) ||
    !['direct','flex','strict'].includes(body.plan)) {
    return fail('请只指定设备 MAC 和目标上网方案',400);
  }
  const plan=body.plan as DevicePlan;
  // Strict LA is a privileged, network-wide capability. A Web request cannot
  // enable it: the Q4 host must independently attest and enforce isolation.
  try {
    const [snapshot,controllers,oneClickSnapshot]=await Promise.all([
      getLanSnapshot(),getRuntimeStatuses(),getOneClickSnapshot(),
    ]);
    if (controllers.some(controller=>controller.available && controller.managedMac===body.mac)) {
      return fail('此设备已由原共享控制器管理，请直接使用原有的线路选择',409);
    }
    if (plan==='strict' && !oneClickSnapshot.strict.available) {
      return fail(oneClickSnapshot.strict.reason || '新设备严格 LA 尚未验收',409);
    }
    if (!oneClickSnapshot.available) {
      return fail('Q4 自动接入控制器暂不可用，未修改设备线路',503);
    }
    const network=await readOneClickNetworkConfig();
    if(plan==='strict') {
      const candidate=snapshot.devices.find(item=>item.mac===body.mac);
      const check=strictEligibility(oneClickSnapshot.strict,network.wifiInterfaceAlias,candidate?.wifiInterfaceAlias);
      if(!check.available)return fail(check.reason || 'LA 安全验收未通过；未修改线路',409);
    }
    const alreadyManaged=oneClickSnapshot.states.find(state=>state.managedMac===body.mac);
    if (alreadyManaged && alreadyManaged.phase === 'active') {
      await changeOneClickPlan(alreadyManaged.managedMac,alreadyManaged.managedIp,plan);
      const selected=snapshot.devices.find(x=>x.mac===body.mac);
      const selection=devicePlanState(await assignDevice(
        selected || {mac:alreadyManaged.managedMac,name:'已接入 Q4 的设备'},plan,
      ));
      return Response.json({
        outcome:'q4-rule-updated',selection,
        message:'Q4 已更新这台设备的'+
          (plan==='direct'?'家庭宽带直连':plan==='flex'?'新加坡分流':'洛杉矶严格出口')+
          '规则，无需修改设备网关或再次接入。实际出口以设备测试为准。',
      },{headers});
    }
    if(alreadyManaged && plan==='direct') {
      const selection=devicePlanState(await assignDevice({
        mac:alreadyManaged.managedMac,name:'已登记 Q4 的设备',
      },'direct'));
      return Response.json({
        outcome:'q4-fallback-direct',selection,
        message:'已保持家庭宽带直连；保留 Q4 设备防护。无需修改设备网络设置。',
      },{headers});
    }
    if(snapshot.status!=='live')return fail('中兴设备记录不可用，未改变线路',503);
    const device=snapshot.devices.find(x=>x.mac===body.mac);
    if(!device || device.online!==true || !device.ip)
      return fail('该设备当前不在线或 IP 未确认，不改变网关',409);
    if(plan==='direct') {
      const selection=devicePlanState(await assignDevice(device,'direct'));
      return Response.json({
        selection, outcome:'router-direct', message:'已选择家庭宽带直连；没有修改中兴或 Q4 网关。',
      },{headers});
    }
    const managed=new Set(controllers.filter(x=>x.available).map(x=>x.managedMac));
    const {device:verified}=validateDirectCandidate(
      snapshot,device.mac,device.ip,managed,true,network,
    );
    // Admin's choice in this webpage authorizes ONLY this individual MAC/IP.
    // Unknown SSID is never represented as confirmed dedicated interface.
    const result=await activateFromSingleWebChange(
      {mac:verified.mac,ip:verified.ip,name:verified.name},plan,
      createOneClickAgent(network),
    );
    const selection=devicePlanState(await assignDevice(device,plan));
    return Response.json({
      outcome:result.outcome,selection,
      gatewayApplied:result.q4Managed,
      // Binding confirmation is not DHCP renewal: wait for real Q4 packet observation.
      message:'已为这台设备准备 Q4 '+
        (plan==='flex'?'新加坡分流':'洛杉矶严格出口')+
        '并完成中兴网关绑定；如仍走原宽带，断开并重连一次专用 Wi-Fi。实际生效以 Q4 流量为准。',
    },{headers});
  } catch(error) {
    return fail(error instanceof Error ? error.message.slice(0,220) : '自动接入失败，未确认线路改变',503);
  }
}