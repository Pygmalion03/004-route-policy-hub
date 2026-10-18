#!/usr/bin/env python3
"""Prepare a private REALITY bundle; deploy only with explicit --deploy and SSH access."""
import argparse
import base64
import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import uuid
from urllib.parse import urlencode, quote

XRAY_VERSION = 'v26.3.27'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--host', help='VPS IP; omitted when reusing a prepared inventory')
parser.add_argument('--ssh-port', type=int, default=61234)
parser.add_argument('--port', type=int, default=443)
parser.add_argument('--name', default='Legend SG')
parser.add_argument('--sni', default='www.apple.com')
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--deploy', action='store_true')
args = parser.parse_args()
if not args.host:
    try: args.host = json.loads((args.output / 'inventory.json').read_text())['host']
    except (OSError, KeyError, ValueError): parser.error('Pass --host when preparing a new VPS bundle')
ipaddress.ip_address(args.host)
if not 1 <= args.port <= 65535 or not 1 <= args.ssh_port <= 65535:
    parser.error('Port must be between 1 and 65535')
if not args.sni or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789.-' for c in args.sni):
    parser.error('SNI must be a DNS name')
args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
args.output.chmod(0o700)

def write_private(name, text):
    p = args.output / name
    p.write_text(text)
    p.chmod(0o600)

if (args.output / 'server.json').exists():
    inventory = json.loads((args.output / 'inventory.json').read_text())
    if any(inventory.get(k) != v for k, v in {'host': args.host, 'ssh_port': args.ssh_port, 'port': args.port, 'sni': args.sni}.items()):
        raise SystemExit('Existing bundle belongs to different settings; choose a separate output directory')
    config = json.loads((args.output / 'server.json').read_text())
else:
    with tempfile.TemporaryDirectory() as temporary:
        key = Path(temporary) / 'key.pem'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'X25519', '-out', str(key)], check=True, capture_output=True)
        private_der = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-outform', 'DER'], stderr=subprocess.DEVNULL)
        public_der = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER'], stderr=subprocess.DEVNULL)
    encode = lambda data: base64.urlsafe_b64encode(data[-32:]).decode().rstrip('=')
    private_key, public_key = encode(private_der), encode(public_der)
    client_id, short_id = str(uuid.uuid4()), secrets.token_hex(8)
    config = {
        'log': {'loglevel': 'warning'},
        'inbounds': [{'tag': 'route-hub-reality', 'listen': '0.0.0.0', 'port': args.port, 'protocol': 'vless',
            'settings': {'clients': [{'id': client_id, 'flow': 'xtls-rprx-vision'}], 'decryption': 'none'},
            'streamSettings': {'network': 'raw', 'security': 'reality', 'realitySettings': {
                'show': False, 'target': args.sni + ':443', 'xver': 0, 'serverNames': [args.sni],
                'privateKey': private_key, 'shortIds': [short_id]}}}],
        'outbounds': [{'tag': 'internet', 'protocol': 'freedom'}, {'tag': 'blocked', 'protocol': 'blackhole'}],
        'routing': {'rules': [{'type': 'field', 'ip': ['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '::1/128', 'fc00::/7', 'fe80::/10'], 'outboundTag': 'blocked'}]},
    }
    node = {'name': args.name, 'type': 'vless', 'server': args.host, 'port': args.port, 'uuid': client_id,
        'tls': True, 'flow': 'xtls-rprx-vision', 'network': 'tcp', 'udp': True, 'servername': args.sni,
        'client-fingerprint': 'chrome', 'reality-opts': {'public-key': public_key, 'short-id': short_id}}
    query = urlencode({'encryption': 'none', 'security': 'reality', 'type': 'tcp', 'flow': 'xtls-rprx-vision', 'sni': args.sni, 'fp': 'chrome', 'pbk': public_key, 'sid': short_id})
    host = '[' + args.host + ']' if ':' in args.host else args.host
    write_private('client-link.txt', f'vless://{client_id}@{host}:{args.port}?{query}#{quote(args.name)}')
    write_private('client-node.json', json.dumps(node))
    write_private('server.json', json.dumps(config))
    write_private('inventory.json', json.dumps({'host': args.host, 'ssh_port': args.ssh_port, 'port': args.port, 'sni': args.sni, 'name': args.name, 'xray_version': XRAY_VERSION, 'deployment': 'prepared-not-deployed'}))
print('Private server/client bundle prepared. Credentials were not printed.')
if not args.deploy:
    raise SystemExit(0)

# SSH consumes an existing key or a password injected by bw-codex. Never pass a password in argv.
remote_program = r'''
import base64,hashlib,io,json,os,pathlib,pwd,re,shutil,socket,subprocess,tempfile,urllib.request,zipfile
root=pathlib.Path('/etc/route-policy-xray'); unit=pathlib.Path('/etc/systemd/system/route-policy-xray.service')
if os.geteuid()!=0:raise SystemExit('Root access is required for initial installation')
if not shutil.which('systemctl'):raise SystemExit('systemd is required')
if root.exists() and not (root/'.managed-by-route-hub').exists():raise SystemExit('Refusing to replace an unmanaged configuration')
if unit.exists() and 'Managed by Route Policy Hub' not in unit.read_text():raise SystemExit('Refusing to replace an unmanaged service')
if not root.exists():
 s=socket.socket()
 try:s.bind(('0.0.0.0',PORT))
 except OSError:raise SystemExit('The requested proxy port is already occupied')
 finally:s.close()
print('Remote preflight passed',flush=True)
arch=os.uname().machine
asset={'x86_64':'Xray-linux-64.zip','aarch64':'Xray-linux-arm64-v8a.zip'}.get(arch)
if not asset:raise SystemExit('Unsupported CPU architecture')
url='https://github.com/XTLS/Xray-core/releases/download/'+VERSION+'/'+asset
with urllib.request.urlopen(url+'.dgst',timeout=40) as r:digests=r.read().decode()
expected=next((re.findall(r'\b[0-9a-fA-F]{64}\b',line)[-1].lower() for line in digests.splitlines() if '256' in line and re.findall(r'\b[0-9a-fA-F]{64}\b',line)),None)
if not expected:raise SystemExit('Official SHA256 digest unavailable')
with urllib.request.urlopen(url,timeout=90) as r:archive=r.read()
if hashlib.sha256(archive).hexdigest()!=expected:raise SystemExit('Official release checksum mismatch')
binary_dir=pathlib.Path('/usr/local/lib/route-policy-hub');binary_dir.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(io.BytesIO(archive)) as z:binary=z.read('xray')
executable=binary_dir/'xray.next';executable.write_bytes(binary);executable.chmod(0o755)
root.mkdir(mode=0o750,exist_ok=True)
config_path=root/'config.json';temporary=root/'config.next.json';temporary.write_text(json.dumps(CONFIG));temporary.chmod(0o600)
subprocess.run([str(executable),'run','-test','-config',str(temporary)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:account=pwd.getpwnam('route-hub-xray')
except KeyError:
 subprocess.run(['useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','route-hub-xray'],check=True)
 account=pwd.getpwnam('route-hub-xray')
os.chown(root,0,account.pw_gid);root.chmod(0o750)
os.chown(temporary,account.pw_uid,account.pw_gid)
if config_path.exists():shutil.copy2(config_path,root/'config.before-update.json')
os.replace(temporary,config_path)
os.replace(executable,binary_dir/'xray')
unit.write_text(''' + "'''" + r'''# Managed by Route Policy Hub
[Unit]
Description=Route Policy Hub VLESS REALITY
After=network-online.target
Wants=network-online.target
[Service]
User=route-hub-xray
ExecStart=/usr/local/lib/route-policy-hub/xray run -config /etc/route-policy-xray/config.json
Restart=on-failure
RestartSec=3
LimitNOFILE=65536
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
''' + "'''" + r''')
(root/'.managed-by-route-hub').touch(mode=0o600)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','route-policy-xray.service'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['systemctl','restart','route-policy-xray.service'],check=True)
subprocess.run(['systemctl','is-active','--quiet','route-policy-xray.service'],check=True)
print('Managed proxy service active. Real client traffic still requires acceptance.',flush=True)
'''
payload = 'import json\nCONFIG=json.loads(' + repr(json.dumps(config)) + ')\nPORT=' + str(args.port) + '\nVERSION=' + repr(XRAY_VERSION) + '\n' + remote_program
with tempfile.TemporaryDirectory() as temporary:
    env = dict(os.environ)
    if env.get('VPS_SSH_PASSWORD'):
        helper = Path(temporary) / 'askpass'
        helper.write_text('#!/usr/bin/env python3\nimport os\nprint(os.environ["VPS_SSH_PASSWORD"])\n')
        helper.chmod(0o700)
        env.update(SSH_ASKPASS=str(helper), SSH_ASKPASS_REQUIRE='force', DISPLAY=':0')
    result = subprocess.run(['ssh', '-p', str(args.ssh_port), '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'NumberOfPasswordPrompts=1', 'root@'+args.host, 'python3 -'], input=payload, text=True, capture_output=True, env=env)
if result.returncode:
    sensitive = [config['inbounds'][0]['settings']['clients'][0]['id'], config['inbounds'][0]['streamSettings']['realitySettings']['privateKey'], os.environ.get('VPS_SSH_PASSWORD','')]
    diagnostic = result.stderr[-2000:]
    for value in sensitive:
        if value: diagnostic = diagnostic.replace(value,'[redacted]')
    print('Deployment failed:',diagnostic.strip())
    raise SystemExit(result.returncode)
inventory = json.loads((args.output/'inventory.json').read_text());inventory['deployment']='service-active-client-unverified';write_private('inventory.json',json.dumps(inventory))
print('Remote installation finished. Test actual egress and HTTPS traffic before selecting this VPS for daily use.')
