import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { serializeZteSession } from './zte-router-admin';

export type LanDevice = {
  mac: string; name: string; ip: string; online: boolean | null; link: string;
  /** Exact AP alias from the router if supplied; never infer from 2.4G/5G band. */
  wifiInterfaceAlias?: 'SSID1' | 'SSID3' | 'SSID5' | 'SSID7';
};
export type LanSnapshot = {
  status: 'live' | 'unconfigured' | 'unavailable';
  observedAt: string | null;
  devices: LanDevice[];
};

const xmlEntities: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
function xmlText(raw: string) {
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw);
  if (cdata) return cdata[1].trim();
  return raw.replace(/&(#x[\da-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (entity, code: string) => {
    if (code[0] !== '#') return xmlEntities[code] || entity;
    const value = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
  }).trim();
}

export function parseZteDevices(xml: string): LanDevice[] {
  const list = /<OBJ_LAN_INFO_ID(?:\s[^>]*)?>([\s\S]*?)<\/OBJ_LAN_INFO_ID>/.exec(xml)?.[1];
  if (list === undefined && !/<OBJ_LAN_INFO_ID\s*\/>/.test(xml)) throw new Error('路由器未返回设备名单');
  const devices = new Map<string, LanDevice>();
  for (const row of (list || '').matchAll(/<Instance(?:\s[^>]*)?>([\s\S]*?)<\/Instance>/g)) {
    const fields = new Map(Array.from(row[1].matchAll(/<ParaName>([\w]+)<\/ParaName>\s*(?:<ParaValue>([\s\S]*?)<\/ParaValue>|<ParaValue\s*\/>)/g),
      match => [match[1], xmlText(match[2] || '')]));
    const mac = fields.get('MACAddress')?.toLowerCase() || '';
    if (!/^(?:[\da-f]{2}:){5}[\da-f]{2}$/.test(mac) || mac === '00:00:00:00:00:00' || (parseInt(mac.slice(0, 2), 16) & 1) ||
      ['2', '4'].includes(fields.get('DevMeshType') || '') || !['0', '1'].includes(fields.get('Active') || '')) continue;
    const online = fields.get('Active') === '1';
    if (devices.has(mac) && (devices.get(mac)?.online || !online)) continue;
    const address = fields.get('IPAddress') || '';
    // Router client data MAY include IFAliasName (SSID7); confirm on this unit.
    // Band=5GHz does not prove SSID7 because the main Wi-Fi also uses 5GHz.
    const alias = (fields.get('IFAliasName') || '').toUpperCase();
    const wired = fields.get('InterfaceType') === '1';
    const wifiInterfaceAlias = !wired && /^(SSID1|SSID3|SSID5|SSID7)$/.test(alias)
      ? alias as LanDevice['wifiInterfaceAlias'] : undefined;
    devices.set(mac, {
      mac, online,
      name: (fields.get('DevName') || fields.get('HostName') || fields.get('AliasName') || '未命名设备').slice(0, 80),
      ip: isIP(address) === 4 && address !== '0.0.0.0' ? address : '',
      link: wired ? '有线' : fields.get('MLOEnable') === '1' ? 'Wi-Fi · MLO' : fields.get('Band') ? 'Wi-Fi' : '',
      ...(wifiInterfaceAlias ? { wifiInterfaceAlias } : {}),
    });
  }
  return [...devices.values()].sort((first, second) => Number(second.online) - Number(first.online) || first.name.localeCompare(second.name, 'zh'));
}

async function readZteDevices(origin: string, password: string, username: string): Promise<LanDevice[]> {
  const cookies = new Map<string, string>();
  async function call(kind: string, tag: string, parameters: Record<string, string> = {}, form?: Record<string, string>) {
    const url = new URL('/', origin);
    url.search = new URLSearchParams({ _type: kind, _tag: tag, ...parameters }).toString();
    const response = await fetch(url, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${origin}/`, cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
      ...(form ? { method: 'POST', body: new URLSearchParams(form) } : {}),
    });
    if (!response.ok) throw new Error('路由器请求失败');
    for (const value of response.headers.getSetCookie()) {
      const entry = value.split(';', 1)[0];
      const separator = entry.indexOf('=');
      if (separator > 0) cookies.set(entry.slice(0, separator), entry.slice(separator + 1));
    }
    return response.text();
  }
  await call('loginData', 'login_entry');
  const challenge = JSON.parse(await call('loginsceneData', 'login_token_json'));
  if (typeof challenge.logintoken !== 'string' || typeof challenge._sessionToken !== 'string') throw new Error('路由器会话不可用');
  const response = JSON.parse(await call('loginData', 'login_entry', {}, {
    Username: username, Password: createHash('sha256').update(password + challenge.logintoken).digest('hex'),
    action: 'login', Frm_Logintoken: '', captchaCode: '', _sessionTOKEN: challenge._sessionToken,
  }));
  if (response.login_need_refresh !== true && response.login_need_refresh !== 1 && response.login_need_refresh !== '1') throw new Error('路由器未接受登录');
  try {
    return parseZteDevices(await call('vueData', 'localnet_lan_info_lua', { _: String(Date.now()) }));
  } finally {
    if (typeof response.sess_token === 'string') {
      await call('loginData', 'logout_entry', {}, { IF_LogOff: '1', _sessionTOKEN: response.sess_token }).catch(() => {});
    }
  }
}

let last: LanSnapshot | undefined;
let checkedAt = 0;
let pending: Promise<LanSnapshot> | undefined;

export async function getLanSnapshot(): Promise<LanSnapshot> {
  const address = process.env.ZTE_ROUTER_URL;
  const file = process.env.ZTE_ROUTER_CREDENTIALS_FILE;
  if (!address || (!file && !process.env.ZTE_ROUTER_PASSWORD)) return { status: 'unconfigured', observedAt: null, devices: [] };
  if (pending) return pending;
  if (last && Date.now() - checkedAt < 45000) return last;
  pending = (async () => {
    try {
      const url = new URL(address);
      if (url.protocol !== 'http:' || url.username || url.password || isIP(url.hostname) !== 4 ||
        !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(url.hostname)) throw new Error('仅使用局域网路由器地址');
      const credentials = file ? JSON.parse(await readFile(/* turbopackIgnore: true */ file, 'utf8')) : {
        password: process.env.ZTE_ROUTER_PASSWORD, username: process.env.ZTE_ROUTER_USERNAME,
      };
      if (typeof credentials.password !== 'string' || !credentials.password) throw new Error('缺少中兴凭据');
      last = { status: 'live', observedAt: new Date().toISOString(), devices: await serializeZteSession(() =>
        readZteDevices(url.origin, credentials.password, credentials.username || 'admin')) };
    } catch {
      last = { status: 'unavailable', observedAt: last?.observedAt || null, devices: last?.devices.map(device => ({ ...device, online: null })) || [] };
    } finally {
      checkedAt = Date.now();
    }
    return last;
  })().finally(() => { pending = undefined; });
  return pending;
}
