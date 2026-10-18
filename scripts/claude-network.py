#!/usr/bin/env python3
"""Local Claude launcher. Reads routing metadata only; never exports proxy credentials."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
LOCAL = Path.home() / 'Library/Application Support/Route Policy Hub'
RUNTIME = Path.home() / 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml'
PROXY_PORT = 17997

class SetupError(Exception): pass

def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_text(value); path.chmod(0o600)

def route(runtime):
    program = 'v=YAML.load_file(ARGV[0]); puts JSON.generate(v.fetch("listeners",[]).find{|x| x["port"]==17997})'
    r = subprocess.run(['/usr/bin/ruby','-ryaml','-rjson','-e',program,str(runtime)],capture_output=True,text=True)
    try:
        item = json.loads(r.stdout)
        assert item['listen'] == '127.0.0.1'
        name = item['proxy']; assert name.startswith('Claude 固定出口｜')
        expected = str(ipaddress.ip_address(name.split('｜',1)[1]))
    except (ValueError, TypeError, KeyError, AssertionError):
        raise SetupError('尚未加载 Claude 专用配置。请先在网站发布，并刷新 Clash 日常订阅。')
    return expected

def profile():
    p = LOCAL / 'claude-network.sb'
    private_write(p, '''(version 1)
(allow default)
(deny network-outbound (remote tcp "*:*") (remote udp "*:*"))
(deny network-outbound (literal "/private/var/run/mDNSResponder") (literal "/private/var/tmp/mDNSResponder"))
(allow network-outbound (remote tcp "localhost:17997"))
(deny process-exec (literal "/usr/bin/open"))
''')
    return p

def sandbox_command(policy, command):
    # LaunchServices can select Rosetta for script app bundles; force native execution.
    return ['/usr/bin/arch','-arm64','/usr/bin/sandbox-exec','-f',str(policy),*command]

def verify(expected, policy):
    r = subprocess.run(sandbox_command(policy,['/usr/bin/curl','-fsS','--proxy','http://127.0.0.1:17997','--noproxy','','--connect-timeout','5','--max-time','15','https://ipv4.webshare.io/']),capture_output=True,text=True)
    if r.returncode: raise SetupError('Claude 专用代理不可用，已停止启动。不会改走日常线路或直连。')
    try: actual = str(ipaddress.ip_address(r.stdout.strip()))
    except ValueError: raise SetupError('出口检查未返回有效 IP，已停止启动。')
    if actual != expected: raise SetupError('实际出口 IP 与锁定配置不一致，已停止启动。请核对固定出口。')
    return actual

def proxy_environment():
    env = dict(os.environ)
    for k in ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']: env[k] = 'http://127.0.0.1:17997'
    for k in ['NO_PROXY','no_proxy']: env[k] = ''
    env['BROWSER'] = str(ROOT / 'scripts/claude-auth-browser.command')
    return env

def capture_auth(url):
    if urlsplit(url).scheme not in ['http','https']: raise SetupError('登录地址格式不受支持。')
    private_write(LOCAL/'pending-auth.json',json.dumps({'url':url,'createdAt':time.time()}))
    print('登录地址已留在本机。请打开「Claude 专用浏览器」，不要用日常浏览器登录。')

def browser(url=None):
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    if not chrome.exists(): raise SetupError('未找到 Google Chrome。')
    pending = LOCAL/'pending-auth.json'
    if not url and pending.exists():
        item = json.loads(pending.read_text())
        if time.time()-item.get('createdAt',0) < 600: url = item.get('url')
    if url and urlsplit(url).scheme not in ['http','https']: raise SetupError('仅接受 HTTP / HTTPS 网页地址。')
    if url:
        page = '<!doctype html><meta charset="utf-8"><title>Claude 专用登录</title><script>location.replace('+json.dumps(url).replace('<','\\u003c')+')</script>'
    else:
        page = '''<!doctype html><meta charset="utf-8"><title>Claude 专用浏览器</title><style>body{font:18px system-ui;max-width:760px;margin:80px auto;line-height:1.8;color:#173c31}a{color:#12604c}</style><h1>Claude 专用浏览器</h1><p>本浏览器固定使用 Claude 专用代理。与日常浏览器的数据和代理设置分开。</p><p>代理断开时页面连接应失败；浏览器系统级出站防护仍需单独配置和验收。</p><p><a href="https://claude.ai/">打开 Claude</a> · <a href="https://ipv4.webshare.io/">核对当前出口</a></p>'''
    start = LOCAL/'browser-start.html'; private_write(start,page)
    user_data = LOCAL/'Claude Browser'; user_data.mkdir(parents=True,exist_ok=True,mode=0o700)
    args=['/usr/bin/arch','-arm64',str(chrome),'--user-data-dir='+str(user_data),'--no-first-run','--no-default-browser-check','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--proxy-server=http://127.0.0.1:17997','--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost','--new-window',start.as_uri()]
    subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    print('已请求打开 Claude 专用浏览器。系统级浏览器出站限制尚未启用，不能标记为完整防漏。')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--runtime',type=Path,default=RUNTIME)
    parser.add_argument('mode',choices=['check','run','browser','auth-url']);parser.add_argument('arguments',nargs=argparse.REMAINDER);a=parser.parse_args()
    if platform.system()!='Darwin' or platform.machine()!='arm64': raise SetupError('此启动器目前仅在本机 Apple Silicon macOS 验证。')
    if a.mode=='auth-url':
        if not a.arguments:raise SetupError('未收到登录地址。')
        capture_auth(a.arguments[-1]);return
    expected=route(a.runtime);policy=profile();actual=verify(expected,policy)
    if a.mode=='check':print('专用出口已核对：'+actual+'。命令行出站限制可用；浏览器防护及账号生成需分别验收。');return
    if a.mode=='browser':browser(a.arguments[0] if a.arguments else None);return
    cli=Path.home()/'.local/bin/claude'
    if not cli.exists():raise SetupError('尚未安装 Claude Code，请先使用官方安装方式。')
    print('固定出口已核对，正在以网络限制启动 Claude Code。',flush=True)
    os.execvpe('/usr/bin/arch',sandbox_command(policy,[str(cli),*a.arguments]),proxy_environment())

if __name__=='__main__':
    try:main()
    except (SetupError,OSError) as e:print(str(e) if isinstance(e,SetupError) else '本机启动失败，请检查配置与应用安装。',file=sys.stderr);sys.exit(1)
