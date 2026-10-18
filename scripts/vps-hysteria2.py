#!/usr/bin/env python3
"""Install authenticated Hysteria2 alongside the existing VLESS service."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from urllib.parse import quote, urlencode

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--vless-bundle', type=Path, default=Path('data/legend-vps'))
parser.add_argument('--output', type=Path, default=Path('data/legend-hysteria2'))
args = parser.parse_args()
inventory = json.loads((args.vless_bundle/'inventory.json').read_text())
args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
args.output.chmod(0o700)

def private_write(name, value):
    target = args.output/name
    target.write_text(value)
    target.chmod(0o600)

secret_file = args.output/'auth.json'
if secret_file.exists():
    auth = json.loads(secret_file.read_text())
    if auth['host'] != inventory['host']:
        raise SystemExit('Existing credentials belong to another host')
else:
    auth = {'host': inventory['host'], 'password': secrets.token_urlsafe(32)}
    private_write('auth.json', json.dumps(auth))

program = r'''
import hashlib,json,os,pathlib,pwd,socket,subprocess,urllib.request
root=pathlib.Path('/etc/route-policy-hysteria2')
unit=pathlib.Path('/etc/systemd/system/route-policy-hysteria2.service')
if os.geteuid()!=0:raise SystemExit('Root is required for installation')
if root.exists() and not (root/'.managed-by-route-hub').exists():raise SystemExit('Refusing unmanaged configuration')
if unit.exists() and 'Managed by Route Policy Hub' not in unit.read_text():raise SystemExit('Refusing unmanaged service')
if not unit.exists():
 s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.bind(('0.0.0.0',443));s.close()
try:account=pwd.getpwnam('route-hub-hysteria2')
except KeyError:
 subprocess.run(['useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','route-hub-hysteria2'],check=True)
 account=pwd.getpwnam('route-hub-hysteria2')
root.mkdir(mode=0o750,exist_ok=True);os.chown(root,0,account.pw_gid);root.chmod(0o750)
(root/'.managed-by-route-hub').touch(mode=0o600)
if not (root/'cert.pem').exists():
 subprocess.run(['openssl','req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',str(root/'key.pem'),'-out',str(root/'cert.pem'),'-days','3650','-subj','/CN=legend-hy2.internal'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
fp=hashlib.sha256(subprocess.check_output(['openssl','x509','-in',str(root/'cert.pem'),'-outform','DER'])).hexdigest()
version='app/v2.13.0'
req=urllib.request.Request('https://api.github.com/repos/apernet/hysteria/releases/tags/'+version,headers={'User-Agent':'route-policy-hub'})
release=json.load(urllib.request.urlopen(req,timeout=25))
asset=next(a for a in release['assets'] if a['name']=='hysteria-linux-amd64')
expected=asset.get('digest','')
if not expected.startswith('sha256:'):raise SystemExit('Official SHA256 unavailable')
binary=urllib.request.urlopen(asset['browser_download_url'],timeout=90).read()
if hashlib.sha256(binary).hexdigest()!=expected[7:]:raise SystemExit('Official checksum mismatch')
binary_dir=pathlib.Path('/usr/local/lib/route-policy-hub');binary_dir.mkdir(parents=True,exist_ok=True)
exe=binary_dir/'hysteria2.next';exe.write_bytes(binary);exe.chmod(0o755)
config={'listen':':443','tls':{'cert':str(root/'cert.pem'),'key':str(root/'key.pem')},'auth':{'type':'password','password':AUTH['password']},'disableUDP':True,'acl':{'inline':['reject(0.0.0.0/8)','reject(10.0.0.0/8)','reject(172.16.0.0/12)','reject(192.168.0.0/16)','reject(127.0.0.0/8)','reject(169.254.0.0/16)','reject(100.64.0.0/10)','reject(::1/128)','reject(fc00::/7)','reject(fe80::/10)','direct(all)']}}
config_path=root/'config.json'
if config_path.exists():
 previous=json.loads(config_path.read_text())
 if previous['auth']['password']!=AUTH['password']:raise SystemExit('Refusing to rotate existing server credentials')
 temporary=root/'config.before-update.json';temporary.write_text(json.dumps(previous));os.chown(temporary,0,account.pw_gid);temporary.chmod(0o640)
config_path.write_text(json.dumps(config))
for name in ['config.json','cert.pem','key.pem']:
 target=root/name;os.chown(target,0,account.pw_gid);target.chmod(0o640)
os.replace(exe,binary_dir/'hysteria2')
unit.write_text(''' + "'''" + r'''# Managed by Route Policy Hub
[Unit]
Description=Route Policy Hub Hysteria2
Wants=network-online.target
After=network-online.target
[Service]
User=route-hub-hysteria2
ExecStart=/usr/local/lib/route-policy-hub/hysteria2 server -c /etc/route-policy-hysteria2/config.json
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
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','route-policy-hysteria2'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.run(['systemctl','is-active','--quiet','route-policy-hysteria2'],check=True)
print(json.dumps({'fingerprint':fp,'version':version,'vless_active':subprocess.run(['systemctl','is-active','--quiet','route-policy-xray']).returncode==0}))
'''
with tempfile.TemporaryDirectory() as temporary:
    env = dict(os.environ)
    if env.get('VPS_SSH_PASSWORD'):
        helper = Path(temporary)/'askpass'
        helper.write_text('#!/usr/bin/env python3\nimport os\nprint(os.environ["VPS_SSH_PASSWORD"])\n')
        helper.chmod(0o700)
        env.update(SSH_ASKPASS=str(helper), SSH_ASKPASS_REQUIRE='force', DISPLAY=':0')
    result = subprocess.run(['ssh','-p',str(inventory['ssh_port']),'-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-o','NumberOfPasswordPrompts=1','root@'+inventory['host'],'python3 -'], input='AUTH='+repr(auth)+'\n'+program, text=True, capture_output=True, env=env)
if result.returncode:
    diagnostic = result.stderr[-1800:]
    for value in [auth['password'], env.get('VPS_SSH_PASSWORD','')]:
        if value: diagnostic = diagnostic.replace(value,'[redacted]')
    private_write('deployment-error.txt',diagnostic)
    raise SystemExit('Installation failed; sanitized diagnostic saved privately')
status = json.loads(result.stdout)
node = {'name':'Legend SG · Hysteria2','type':'hysteria2','server':inventory['host'],'port':443,'password':auth['password'],'sni':'legend-hy2.internal','fingerprint':status['fingerprint']}
private_write('client-node.json',json.dumps(node))
query = urlencode({'sni':node['sni'],'pinSHA256':node['fingerprint']})
private_write('client-link.txt','hysteria2://'+quote(node['password'],safe='')+'@'+node['server']+':443/?'+query+'#'+quote(node['name']))
private_write('deployment.json',json.dumps(status))
print('Hysteria2 service installed; VLESS retained. Validate the client before switching.')
