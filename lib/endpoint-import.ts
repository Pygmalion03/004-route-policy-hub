import type { Endpoint } from './connections';

// Parse locally: pasted credentials never leave the browser until Save.
export function parseEndpoint(input: string): Endpoint {
  const value = input.trim();
  const candidate = value.match(/(?:https?|socks5h?):\/\/[^\s"'<>]+/i)?.[0];
  if (candidate) {
    try {
      const url = new URL(candidate);
      const type = url.protocol.startsWith('socks5') ? 'socks5' : 'http';
      if (url.protocol === 'https:') throw new Error();
      const port = Number(url.port || (type === 'http' ? 80 : 1080));
      if (
        !url.hostname ||
        !url.username ||
        !url.password ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      )
        throw new Error();
      return {
        type,
        server: url.hostname,
        port,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    } catch {
      throw new Error(
        '请复制带用户名和密码的 HTTP / SOCKS5 代理地址，或使用手动填写。',
      );
    }
  }
  const [server, rawPort, username, ...passwordParts] = value.split(':');
  const port = Number(rawPort),
    password = passwordParts.join(':');
  if (
    !server ||
    /[\s/@]/.test(server) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !username ||
    !password ||
    /[\r\n]/.test(value)
  ) {
    throw new Error(
      '支持官网 curl 命令、带账号密码的代理 URL，或 地址:端口:用户名:密码。',
    );
  }
  return { type: 'http', server, port, username, password };
}
