export type VpsNode = {
  id: string;
  name: string;
  node: Record<string, unknown> & { name: string; server: string; port: number; type: 'vless' };
};

export function parseVpsLink(link: string, name: string): VpsNode['node'] {
  let url: URL;
  try { url = new URL(link); } catch { throw new Error('请填写有效的 VLESS REALITY 链接'); }
  const query = url.searchParams;
  const port = Number(url.port || 443);
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
