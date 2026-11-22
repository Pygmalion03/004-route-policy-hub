// Serialized authenticated ZTE request channel. No credentials are logged;
// all router writes remain in the explicitly selected single-device binding API.
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { isIP } from 'node:net';

export type ZteRequest = (
  kind: string, tag: string, params?: Record<string, string>,
  form?: Record<string, string>,
) => Promise<string>;

let operation: Promise<unknown> = Promise.resolve();
export function serializeZteSession<T>(work: () => Promise<T>): Promise<T> {
  const result = operation.catch(() => {}).then(work);
  operation = result.catch(() => {});
  return result;
}

export async function getZteCredentials() {
  const address = process.env.ZTE_ROUTER_URL;
  const credentialsFile = process.env.ZTE_ROUTER_CREDENTIALS_FILE;
  if (!address || (!credentialsFile && !process.env.ZTE_ROUTER_PASSWORD))
    throw new Error('中兴自动接入缺少现有认证配置');
  const url = new URL(address);
  if (url.protocol !== 'http:' || url.username || url.password || isIP(url.hostname) !== 4 ||
    !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
    url.pathname !== '/' || url.search || url.hash) {
    throw new Error('中兴管理地址必须是局域网根地址');
  }
  let value: Record<string, unknown>;
  if (credentialsFile) {
    const file = await lstat(credentialsFile);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('中兴认证文件不安全');
    value = JSON.parse(await readFile(credentialsFile, 'utf8'));
  } else {
    value = { username: process.env.ZTE_ROUTER_USERNAME, password: process.env.ZTE_ROUTER_PASSWORD };
  }
  if (typeof value.password !== 'string' || !value.password ||
    (value.username !== undefined && typeof value.username !== 'string')) {
    throw new Error('中兴管理凭据格式不匹配');
  }
  return { origin: url.origin, username: (value.username as string) || 'admin', password: value.password };
}

/** Must be called only inside serializeZteSession() for active-admin GET/POST. */
export async function withZteLogin<T>(operate: (req: ZteRequest) => Promise<T>): Promise<T> {
  const { origin, username, password } = await getZteCredentials();
  const cookies = new Map<string, string>();
  // ZTE's original Axios interceptor appends the current session token to
  // EVERY management POST, including static_bindAddr_data. Cookie alone is
  // sufficient for some GETs but not for authorized router mutations.
  let sessionToken: string | null = null;
  const req: ZteRequest = async (kind, tag, params = {}, form) => {
    const url = new URL('/', origin);
    url.search = new URLSearchParams({ _type: kind, _tag: tag, ...params }).toString();
    // The login request uses the challenge's _sessionTOKEN. After login,
    // management writes require the fresh token from the accepted session;
    // never reuse the pre-login challenge for post-login configuration.
    if (form && kind === 'vueData' && (!sessionToken || !/^[-\w]{1,256}$/.test(sessionToken))) {
      throw new Error('中兴缺少有效会话令牌，禁止修改路由器');
    }
    const requestForm = form && kind === 'vueData'
      ? { ...form, _sessionTOKEN: sessionToken! } : form;
    const response = await fetch(url, {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: {
        'x-requested-with': 'XMLHttpRequest', referer: origin + '/',
        cookie: [...cookies].map(([k,v]) => k + '=' + v).join('; '),
      },
      ...(requestForm ? { method: 'POST', body: new URLSearchParams(requestForm) } : {}),
    });
    if (!response.ok) throw new Error('中兴接口 HTTP 请求失败');
    for (const header of response.headers.getSetCookie()) {
      const entry = header.split(';',1)[0];
      const equals = entry.indexOf('=');
      if (equals > 0) cookies.set(entry.slice(0,equals),entry.slice(equals+1));
    }
    // The ZTE response interceptor also refreshes the session token when
    // the firmware sends x_xsrf_token on an authenticated API response.
    const refreshedToken = response.headers.get('x_xsrf_token');
    if (sessionToken && refreshedToken && /^[-\w]{1,256}$/.test(refreshedToken)) {
      sessionToken = refreshedToken;
    }
    const text = await response.text();
    if (text.length > 700_000 || text.includes('<IF_ERRORSTR>SessionTimeout</IF_ERRORSTR>') ||
      /<html|<!DOCTYPE html/i.test(text.slice(0,600))) {
      throw new Error('中兴管理会话过期或接口返回登录页');
    }
    return text;
  };
  await req('loginData','login_entry');
  const token = JSON.parse(await req('loginsceneData','login_token_json'));
  if (typeof token.logintoken !== 'string' || typeof token._sessionToken !== 'string')
    throw new Error('中兴挑战令牌无效');
  const result = JSON.parse(await req('loginData','login_entry',{},{
    Username: username,
    Password: createHash('sha256').update(password+token.logintoken).digest('hex'),
    action: 'login', Frm_Logintoken: '', captchaCode: '',
    _sessionTOKEN: token._sessionToken,
  }));
  if (![true,1,'1'].includes(result.login_need_refresh))
    throw new Error('中兴拒绝了管理登录');
  // Original router frontend explicitly assigns g_sessionTmpToken=sess_token
  // after the login POST and injects it into subsequent POST bodies.
  if (typeof result.sess_token !== 'string' || !/^[-\w]{1,256}$/.test(result.sess_token)) {
    throw new Error('中兴登录没有返回有效会话令牌');
  }
  sessionToken = result.sess_token;
  try {
    return await operate(req);
  } finally {
    if (typeof result.sess_token === 'string') {
      await req('loginData','logout_entry',{},{
        IF_LogOff:'1',_sessionTOKEN:result.sess_token,
      }).catch(()=>{});
    }
  }
}
