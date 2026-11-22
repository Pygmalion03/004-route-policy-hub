// Private deployment configuration. Never include the real file in source control.
import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

export type OneClickNetworkConfig = {
  version: 1;
  lanCidr: string;
  gatewayIp: string;
  routerIp: string;
  reservedIps: string[];
  wifiInterfaceAlias: string;
};

const MAX_BYTES = 16 * 1024;
const unavailable = () => new Error('新设备自动接入配置不可用，请联系管理员检查');
const expectedKeys = 'gatewayIp,lanCidr,reservedIps,routerIp,version,wifiInterfaceAlias';

function networkPrefix(cidr: string): string | null {
  if (typeof cidr !== 'string' || !cidr.endsWith('/24')) return null;
  const address = cidr.slice(0, -3);
  if (isIP(address) !== 4) return null;
  const octets = address.split('.').map(Number);
  if (octets[3] !== 0 || !(octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168))) return null;
  return octets.slice(0, 3).join('.') + '.';
}

function isLanHost(ip: string, prefix: string): boolean {
  if (typeof ip !== 'string' || isIP(ip) !== 4 || !ip.startsWith(prefix)) return false;
  const host = Number(ip.split('.')[3]);
  return host >= 1 && host <= 254;
}

function parseConfig(value: unknown): OneClickNetworkConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== expectedKeys) throw unavailable();
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.lanCidr !== 'string' ||
    typeof candidate.gatewayIp !== 'string' || typeof candidate.routerIp !== 'string' ||
    typeof candidate.wifiInterfaceAlias !== 'string' ||
    !/^SSID[1-9][0-9]{0,2}$/.test(candidate.wifiInterfaceAlias) ||
    !Array.isArray(candidate.reservedIps) || candidate.reservedIps.length < 1 ||
    candidate.reservedIps.length > 32) throw unavailable();
  const prefix = networkPrefix(candidate.lanCidr);
  if (!prefix || !isLanHost(candidate.gatewayIp, prefix) ||
    !isLanHost(candidate.routerIp, prefix) ||
    candidate.reservedIps.some(ip => typeof ip !== 'string' || !isLanHost(ip, prefix)) ||
    new Set(candidate.reservedIps).size !== candidate.reservedIps.length ||
    !candidate.reservedIps.includes(candidate.gatewayIp) ||
    !candidate.reservedIps.includes(candidate.routerIp)) throw unavailable();
  return {
    version: 1,
    lanCidr: candidate.lanCidr,
    gatewayIp: candidate.gatewayIp,
    routerIp: candidate.routerIp,
    reservedIps: [...candidate.reservedIps] as string[],
    wifiInterfaceAlias: candidate.wifiInterfaceAlias,
  };
}

export function isAllowedOneClickIp(ip: string, config: OneClickNetworkConfig): boolean {
  const prefix = networkPrefix(config.lanCidr);
  return !!prefix && isLanHost(ip, prefix) && ip !== config.gatewayIp &&
    ip !== config.routerIp && !config.reservedIps.includes(ip);
}

export async function readOneClickNetworkConfig(): Promise<OneClickNetworkConfig> {
  let handle: FileHandle | undefined;
  try {
    const dataDir = process.env.DATA_DIR;
    if (!dataDir) throw unavailable();
    const file = path.join(dataDir, '.rph-oneclick-network.json');
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_BYTES) throw unavailable();
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual = await handle.stat();
    if (!actual.isFile() || actual.dev !== entry.dev || actual.ino !== entry.ino ||
      actual.size > MAX_BYTES) throw unavailable();
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw unavailable();
    return parseConfig(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
  } catch {
    // Do not expose local paths, file contents, parser errors or deployment details.
    throw unavailable();
  } finally {
    await handle?.close().catch(() => {});
  }
}
