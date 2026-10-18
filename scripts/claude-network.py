#!/usr/bin/env python3
"""Local Claude launcher. Reads routing metadata only; never exports proxy credentials."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import plistlib
import shlex
import subprocess
import sys
import tempfile
import time
import uuid
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

def profile(project=None, grants=(), session=None):
    suffix = '-'+hashlib.sha256(str(project).encode()).hexdigest()[:12] if project else ''
    p = (session/'network.sb') if session else LOCAL / ('claude-network'+suffix+'.sb')
    protected = [ROOT/'scripts', LOCAL, RUNTIME.parent]
    protected_paths = ' '.join('(subpath '+json.dumps(str(path))+')' for path in protected)
    filesystem = ''
    if project:
        home = Path.home()
        readable = [project, home/'.claude', home/'.claude.json', home/'.local/share/claude', home/'.local/bin/claude', ROOT/'scripts']
        writable = [project, home/'.claude', Path(tempfile.gettempdir()).resolve(), Path('/private/tmp')/('claude-'+str(os.getuid()))]
        filters = lambda paths: ' '.join('(subpath '+json.dumps(str(path))+')' for path in paths)
        filesystem = '(deny file-read* (subpath '+json.dumps(str(home))+'))\n'
        filesystem += '(allow file-read-metadata (subpath '+json.dumps(str(home))+'))\n'
        filesystem += '(allow file-read* '+filters(readable)+')\n'
        filesystem += '(deny file-write*)\n(allow file-write* '+filters(writable)+' (literal "/dev/null") (literal "/dev/tty"))\n'
        # Claude atomically updates its own config using adjacent temporary files.
        config_pattern = '^'+str(home).replace('.', '\\.')+'/\\.claude\\.json[^/]*$'
        filesystem += '(allow file-read* file-write* (regex '+json.dumps(config_pattern)+'))\n'
        for grant in grants:
            match = '(subpath ' if grant['directory'] else '(literal '
            match += json.dumps(grant['path'])+')'
            operations = 'file-read* file-write*' if grant['access'] == 'write' else 'file-read*'
            filesystem += '(allow '+operations+' '+match+')\n'
        if session:
            filesystem += '(allow file-read* (subpath '+json.dumps(str(session))+'))\n'
    private_write(p, '''(version 1)
(allow default)
(deny network-outbound)
(deny network-outbound (literal "/private/var/run/mDNSResponder") (literal "/private/var/tmp/mDNSResponder"))
(allow network-outbound (remote tcp "localhost:17997"))
(deny process-exec (literal "/usr/bin/open"))
(deny appleevent-send)
'''+ filesystem + '(deny file-write* '+protected_paths+')\n'+
        '(allow file-write* (literal '+json.dumps(str(LOCAL/'pending-auth.json'))+'))\n'+
        ('(allow file-write* (subpath '+json.dumps(str(session/'requests'))+'))\n' if session else ''))
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

def browser_guard():
    base = Path('/Library/Objective-See/LuLu')
    try:
        prefs = plistlib.loads((base/'preferences.plist').read_bytes())
        assert not any(prefs.get(k) for k in ['disabled','allowLocalHost','useAllowList','passiveMode','currentProfile'])
        state = subprocess.run(['/usr/bin/systemextensionsctl','list'],capture_output=True,text=True,check=True).stdout
        assert any('com.objective-see.lulu.extension' in line and '[activated enabled]' in line for line in state.splitlines())
        objects = plistlib.loads((base/'rules.plist').read_bytes())['$objects']
        def ref(value):
            while isinstance(value,plistlib.UID): value = None if value.data == 0 else objects[value.data]
            return value
        ids = ['com.microsoft.edgemac','com.microsoft.edgemac.helper','com.microsoft.edgemac.helper.renderer']
        for identifier in ids:
            key = identifier+':Developer ID Application: Microsoft Corporation (UBF8T346G9)'
            rules = [{k:ref(v) for k,v in item.items()} for item in objects if isinstance(item,dict) and 'endpointAddr' in item and ref(item.get('key'))==key and not ref(item.get('isDisabled'))]
            assert any(r.get('action')==0 and r.get('endpointAddr')=='*' and r.get('endpointPort')=='*' and not r.get('pid') and not r.get('expiration') for r in rules)
            allowed = [r for r in rules if r.get('action')==1]
            assert allowed and all(r.get('endpointAddr')=='127.0.0.1' and r.get('endpointPort')=='17997' for r in allowed)
    except (OSError,ValueError,KeyError,AssertionError,subprocess.SubprocessError):
        raise SetupError('Edge 防火墙保护未就绪或规则已改变，已停止打开浏览器。请先检查 LuLu 扩展、回环例外和 Edge 规则。')

def browser(actual, url=None):
    browser_guard()
    edge = Path('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
    if not edge.exists(): raise SetupError('未找到 Microsoft Edge。')
    pending = LOCAL/'pending-auth.json'
    if not url and pending.exists():
        item = json.loads(pending.read_text())
        if time.time()-item.get('createdAt',0) < 600: url = item.get('url')
    if url and urlsplit(url).scheme not in ['http','https']: raise SetupError('仅接受 HTTP / HTTPS 网页地址。')
    if url:
        page = '<!doctype html><meta charset="utf-8"><title>Claude 专用登录</title><script>location.replace('+json.dumps(url).replace('<','\\u003c')+')</script>'
    else:
        page = '''<!doctype html><meta charset="utf-8"><title>Claude 专用 Edge</title><style>body{font:18px system-ui;max-width:760px;margin:80px auto;line-height:1.8;color:#173c31}a{color:#12604c}</style><h1>Claude 专用 Edge</h1><p>本次启动已核对固定出口与 LuLu 规则。日常网络切换不改变这里的出口。</p><p>请保持 Clash 与 LuLu 运行。代理不可用时停止连接，不改走其他线路。</p><p><a href="https://claude.ai/">打开 Claude</a> · <a href="https://ipv4.webshare.io/">核对当前出口</a></p>'''
    start = LOCAL/'browser-start.html'; private_write(start,page)
    user_data = LOCAL/'Claude Edge'; user_data.mkdir(parents=True,exist_ok=True,mode=0o700)
    args=['/usr/bin/arch','-arm64',str(edge),'--user-data-dir='+str(user_data),'--lang=en-SG','--accept-lang=en-SG,en','--no-first-run','--no-default-browser-check','--disable-quic','--disable-background-networking','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--proxy-server=http://127.0.0.1:17997','--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1','--new-window',start.as_uri()]
    subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
    print('固定出口：'+actual+'\nLuLu 扩展与 Edge 规则已核对。已请求打开专用 Edge。')

def approve_path(request):
    target = Path(request['path']).resolve()
    access = request['access']
    # Atomic editors need the containing directory for temporary files and rename.
    scope = target.parent if access == 'write' and not target.is_dir() else target
    protected = [ROOT/'scripts', LOCAL, RUNTIME.parent]
    if scope == Path('/') or scope == Path.home() or any(scope == p or p in scope.parents or scope in p.parents for p in protected):
        print('未授权：请求包含整个主目录或启动器保护目录。请改为具体文件 / 子目录。', flush=True)
        return None
    helper = Path.home()/'Applications/Claude 项目启动器.app/Contents/MacOS/ClaudeProject'
    result = subprocess.run([str(helper), '--approve-path', str(scope), '--access', access], capture_output=True, text=True)
    if result.returncode or result.stdout.strip() != 'allow':
        return None
    return {'path': str(scope), 'access': access, 'directory': scope.is_dir()}


def run_session(project, cli, arguments):
    session = LOCAL/'sessions'/uuid.uuid4().hex
    (session/'requests').mkdir(parents=True, mode=0o700)
    session_id = str(uuid.uuid4())
    grants = []
    denied = set()
    hook = shlex.join(['/usr/bin/python3', '-I', str(ROOT/'scripts/claude-permissions.py')])
    settings = {'hooks': {'PreToolUse': [{'matcher': 'Read|Edit|Write|NotebookEdit|Glob|Grep', 'hooks': [{'type': 'command', 'command': hook}]}]}}
    options = ['--setting-sources', '', '--settings', json.dumps(settings), '--permission-mode', 'acceptEdits', '--no-chrome', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
    env = proxy_environment()
    env['CLAUDE_SAFE_SESSION'] = str(session)
    current = ['--session-id', session_id]
    child = None
    try:
        while True:
            private_write(session/'scope.json', json.dumps({'project': str(project), 'session_id': session_id, 'grants': grants, 'denied': list(denied)}))
            policy = profile(project, grants, session)
            child = subprocess.Popen(sandbox_command(policy, [str(cli), *arguments, *current, *options]), env=env, cwd=project)
            restart = False
            while child.poll() is None:
                for file in sorted((session/'requests').glob('*.json')):
                    try:
                        request = json.loads(file.read_text())
                        if request['session_id'] != session_id or request['access'] not in ['read', 'write']:
                            continue
                        key = (request['path'], request['access'])
                        if key in denied:
                            continue
                        grant = approve_path(request)
                        if grant:
                            grants.append(grant)
                            restart = True
                            break
                        denied.add(key)
                        private_write(session/'scope.json', json.dumps({'project': str(project), 'session_id': session_id, 'grants': grants, 'denied': list(denied)}))
                        print('已拒绝项目外访问：'+request['path'], flush=True)
                    except (OSError, ValueError, KeyError, TypeError):
                        print('忽略无效的目录权限请求。', flush=True)
                    finally:
                        file.unlink(missing_ok=True)
                if restart:
                    break
                time.sleep(0.25)
            if not restart:
                return child.wait()
            print('已授予本次会话的'+('读写' if grant['access'] == 'write' else '只读')+'范围：'+grant['path']+'；正在恢复会话。', flush=True)
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            current = ['--resume', session_id]
    except KeyboardInterrupt:
        if child and child.poll() is None:
            child.wait()
        return 130
    finally:
        if child and child.poll() is None:
            child.terminate()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--runtime',type=Path,default=RUNTIME)
    parser.add_argument('--project',type=Path)
    parser.add_argument('mode',choices=['check','run','browser','auth-url']);parser.add_argument('arguments',nargs=argparse.REMAINDER);a=parser.parse_args()
    if platform.system()!='Darwin' or platform.machine()!='arm64': raise SetupError('此启动器目前仅在本机 Apple Silicon macOS 验证。')
    if a.mode=='auth-url':
        if not a.arguments:raise SetupError('未收到登录地址。')
        capture_auth(a.arguments[-1]);return
    project = (a.project or Path.cwd()).resolve() if a.mode == 'run' else None
    if project and (not project.is_dir() or project == Path.home() or project == Path('/')):
        raise SetupError('请选择具体项目文件夹，不要选择主目录或磁盘根目录。')
    expected=route(a.runtime);policy=profile(project);actual=verify(expected,policy)
    if a.mode=='check':
        browser_guard()
        print('固定出口：'+actual+'\n受限命令行检查：已通过\nLuLu 扩展与 Edge 规则：已核对',flush=True)
        r=subprocess.run(sandbox_command(policy,['/usr/bin/curl','-sS','--proxy','http://127.0.0.1:17997','--noproxy','','--connect-timeout','5','--max-time','15','-o','/dev/null','-w','%{http_code} %{time_starttransfer}','https://api.anthropic.com/v1/models']),capture_output=True,text=True)
        parts=r.stdout.split()
        if r.returncode or len(parts)!=2:raise SetupError('Anthropic HTTPS 请求失败或超时。请检查专用线路。')
        if parts[0] not in ['200','401']:raise SetupError('Anthropic 返回 HTTP '+parts[0]+'，请核查服务访问情况。')
        print('Anthropic HTTPS：HTTP '+parts[0]+'，首响应 '+parts[1]+' 秒\n这是本次连通性检查，不代表账号登录、生成或长期稳定性已通过。')
        return
    if a.mode=='browser':browser(actual,a.arguments[0] if a.arguments else None);return
    cli=Path.home()/'.local/bin/claude'
    if not cli.exists():raise SetupError('尚未安装 Claude Code，请先使用官方安装方式。')
    os.chdir(project)
    print('固定出口已核对。工作区：'+str(project)+'\n目录内自动编辑；项目外文件工具触发申请，批准后恢复会话。SSH 与浏览器自动连接关闭。',flush=True)
    raise SystemExit(run_session(project, cli, a.arguments))

if __name__=='__main__':
    try:main()
    except (SetupError,OSError) as e:print(str(e) if isinstance(e,SetupError) else '本机启动失败，请检查配置与应用安装。',file=sys.stderr);sys.exit(1)
