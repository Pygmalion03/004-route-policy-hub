export type VpsNode = {
  id: string;
  name: string;
  node: Record<string, unknown> & { name: string; server: string; port: number; type: 'vless' | 'hysteria2' };
};

export function parseVpsLink(link: string, name: string): VpsNode['node'] {
  let url: URL;
  try { url = new URL(link); } catch { throw new Error('请填写有效的 VLESS REALITY 或 Hysteria2 链接'); }
  const query = url.searchParams;
  const port = Number(url.port || 443);
  if (['hysteria2:', 'hy2:'].includes(url.protocol)) {
    const password = decodeURIComponent(url.username) + (url.password ? `:${decodeURIComponent(url.password)}` : '');
    const fingerprint = (query.get('pinSHA256') || '').replaceAll(':', '');
    const sni = query.get('sni') || url.hostname.replace(/^\[|\]$/g, '');
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535 || !password ||
      /[\r\n]/.test(password) || password.includes(String.fromCharCode(0)) || !/^[a-z0-9.:-]+$/i.test(sni) ||
      (fingerprint && !/^[0-9a-f]{64}$/i.test(fingerprint)) ||
      !['', '0', 'false'].includes(query.get('insecure') || '') || query.has('obfs') || query.has('ech')) {
      throw new Error('请核对 Hysteria2 的地址、端口、认证、SNI 和证书指纹；不支持关闭证书校验、混淆或 ECH 的链接');
    }
    return {
      name, type: 'hysteria2', server: url.hostname.replace(/^\[|\]$/g, ''), port, password, sni,
      ...(fingerprint ? { fingerprint: fingerprint.toLowerCase() } : {}),
    };
  }
  const uuid = decodeURIComponent(url.username);
  const publicKey = query.get('pbk') || '';
  const shortId = query.get('sid') || '';
  const servername = query.get('sni') || '';
  if (url.protocol !== 'vless:' || url.password || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535 ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid) || query.get('security') !== 'reality' ||
    !['tcp', 'raw'].includes(query.get('type') || 'tcp') || (query.get('flow') || 'xtls-rprx-vision') !== 'xtls-rprx-vision' ||
    !/^[A-Za-z0-9_-]{43}$/.test(publicKey) || !/^(?:[0-9a-f]{2}){0,8}$/i.test(shortId) || !/^[a-z0-9.-]+$/i.test(servername)) {
    throw new Error('当前支持 VLESS REALITY / TCP / Vision；请核对节点链接中的端口、UUID、SNI、公钥和 short ID');
  }
  return {
    name, type: 'vless', server: url.hostname.replace(/^\[|\]$/g, ''), port, uuid,
    flow: 'xtls-rprx-vision', network: 'tcp', udp: true, tls: true,
    servername, 'client-fingerprint': 'chrome', 'reality-opts': { 'public-key': publicKey, 'short-id': shortId },
  };
}
