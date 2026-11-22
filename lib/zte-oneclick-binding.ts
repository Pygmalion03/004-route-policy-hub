// ZTE BE7200 MAX's actual static_bindAddr_data API, reconstructed from
// the firmware's current UI bundle. This module must only run AFTER
// Q4 host interception has been installed for the exact MAC and IP.
import { isIP } from 'node:net';
import { isAllowedOneClickIp, type OneClickNetworkConfig } from './oneclick-network-config';
import type { ActivationAgent, SingleDevice } from './one-click-device-activation';
import { serializeZteSession, withZteLogin, type ZteRequest } from './zte-router-admin';

const ZTE_BIND_TAG='static_bindAddr_data';
const MAC=/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const escapeXml=(text:string)=>text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');

export type ZteBinding = { instance: string; name: string; mac: string; ip: string; gateway: string };
export function parseZteBindings(xml: string): ZteBinding[] {
  if (!xml.includes('OBJ_DHCPBIND_ID') ||
    xml.includes('<IF_ERRORSTR>SessionTimeout</IF_ERRORSTR>') ||
    /<!DOCTYPE|<!ENTITY|<html/i.test(xml)) throw new Error('中兴静态绑定表未通过验证');
  const container=/<OBJ_DHCPBIND_ID(?:\s[^>]*)?>([\s\S]*?)<\/OBJ_DHCPBIND_ID>/i.exec(xml);
  if (!container && !/<OBJ_DHCPBIND_ID\s*\/>/i.test(xml))
    throw new Error('中兴静态绑定表结构变化');
  const bindings: ZteBinding[]=[];
  for (const row of (container?.[1]||'').matchAll(/<Instance(?:\s[^>]*)?>([\s\S]*?)<\/Instance>/g)) {
    const fields = new Map([...row[1].matchAll(
      /<ParaName>([A-Za-z_][\w]*)<\/ParaName>\s*(?:<ParaValue>([\s\S]*?)<\/ParaValue>|<ParaValue\s*\/>)/g,
    )].map(entry=>[entry[1],escapeXml(entry[2]||'')]));
    const mac=(fields.get('MACAddr')||'').toLowerCase();
    const ip=fields.get('IPAddr')||'';
    if (!MAC.test(mac) || isIP(ip)!==4) throw new Error('中兴存在无法识别的绑定项，停止自动化');
    bindings.push({
      instance:fields.get('_InstID')||'',
      name:fields.get('Name')||'',
      mac,ip,gateway:fields.get('IPRouters')||'',
    });
  }
  return bindings;
}
const bindingName=(mac:string)=>'RPH-'+mac.slice(-8).replaceAll(':','');
function validateDevice(d:SingleDevice,config:OneClickNetworkConfig) {
  if (!MAC.test(d.mac) || !isAllowedOneClickIp(d.ip,config))
    throw new Error('设备 MAC/IP 不在受控许可范围');
}
async function query(req:ZteRequest) {
  return parseZteBindings(await req('vueData', ZTE_BIND_TAG, { _: String(Date.now()) }));
}
async function bindInside(
  req:ZteRequest,d:SingleDevice,config:OneClickNetworkConfig,onCreateAttempt:()=>void,
): Promise<ZteBinding | null> {
  const before=await query(req);
  const matches=before.filter(row=>row.mac===d.mac || row.ip===d.ip);
  if (matches.length === 1 && matches[0].mac===d.mac &&
      matches[0].ip===d.ip && matches[0].gateway===config.gatewayIp &&
      matches[0].name===bindingName(d.mac)) {
    // Retry an interrupted ONE-CLICK request without rewriting this
    // controller-owned exact reservation or asking the user to configure it.
    return null;
  }
  if (matches.length) throw new Error('中兴已有其他 MAC/IP 绑定，不自动覆盖');
  // A lost response can follow a successful write; remember ownership before POST.
  onCreateAttempt();
  const result=await req('vueData',ZTE_BIND_TAG,{},{
    IF_ACTION:'Apply',_InstID:'-1',Name:bindingName(d.mac),
    MACAddr:d.mac,IPAddr:d.ip,IPRouters:config.gatewayIp,
  });
  if (!/<IF_ERRORSTR>SUCC<\/IF_ERRORSTR>/.test(result))
    throw new Error('中兴没有确认静态绑定成功');
  const after=await query(req);
  const matching=after.filter(x=>x.mac===d.mac && x.ip===d.ip &&
    x.gateway===config.gatewayIp && x.name===bindingName(d.mac));
  if (matching.length!==1) throw new Error('中兴未回读确认设备 Q4 网关绑定');
  return matching[0];
}
/** A single activation owns only the reservation it attempted to create. */
export function createZteBindingTransaction(
  network: OneClickNetworkConfig,
): Pick<ActivationAgent, 'bindRouterToQ4' | 'restoreRouter'> {
  // Pin the validated configuration for bind AND rollback, even if the file changes.
  const config = { ...network, reservedIps: [...network.reservedIps] };
  let identity: { mac: string; ip: string } | null = null;
  let createAttempted = false;
  let createdInstance: string | null = null;
  function scope(device: SingleDevice) {
    validateDevice(device, config);
    if (identity && (identity.mac !== device.mac || identity.ip !== device.ip)) {
      throw new Error('接入事务不能改动另一台设备');
    }
    identity = { mac: device.mac, ip: device.ip };
  }
  return {
    bindRouterToQ4: async device => {
      scope(device);
      const created = await serializeZteSession(() => withZteLogin(req =>
        bindInside(req, device, config, () => {
          createAttempted = true;
          createdInstance = null;
        }),
      ));
      if (created) createdInstance = created.instance;
    },
    restoreRouter: async device => {
      scope(device);
      // An existing exact binding, or an error before POST, grants no deletion right.
      if (!createAttempted) return;
      await serializeZteSession(() => withZteLogin(async req => {
        const rows = await query(req);
        const matching = rows.filter(row => row.mac === device.mac && row.ip === device.ip &&
          row.gateway === config.gatewayIp && row.name === bindingName(device.mac));
        if (matching.length === 0) {
          if (rows.some(row => row.mac === device.mac || row.ip === device.ip)) {
            throw new Error('中兴的设备绑定已被外部修改，不能自动删除');
          }
          createAttempted = false;
          return;
        }
        const row = matching[0];
        if (matching.length !== 1 || !row.instance ||
          !/^[A-Za-z0-9_.-]{1,100}$/.test(row.instance) ||
          (createdInstance !== null && createdInstance !== row.instance)) {
          throw new Error('找不到可以安全撤销的单设备绑定');
        }
        const reply = await req('vueData', ZTE_BIND_TAG, {}, {
          IF_ACTION: 'Delete', _InstID: row.instance, Name: row.name,
          MACAddr: row.mac, IPAddr: row.ip, IPRouters: row.gateway,
        });
        if (!/<IF_ERRORSTR>SUCC<\/IF_ERRORSTR>/.test(reply)) {
          throw new Error('中兴未确认单设备绑定撤销');
        }
        if ((await query(req)).some(item => item.mac === device.mac || item.ip === device.ip)) {
          throw new Error('中兴绑定撤销后仍有匹配记录');
        }
        createAttempted = false;
      }));
    },
  };
}
