#!/usr/bin/env python3
"""Import an authorized local Clash profile without printing its secrets."""
import argparse
import datetime
import json
import os
from pathlib import Path
import secrets
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('profile', type=Path)
parser.add_argument('--data-dir', type=Path, required=True)
args = parser.parse_args()

def yaml_read(file):
    result = subprocess.run(['ruby', '-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), [], [], true))', str(file)], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit('Cannot parse authorized Clash YAML; no credential contents were logged.')
    return json.loads(result.stdout)

config = yaml_read(args.profile)
root = args.profile.parent.parent
proxies = config['proxies']
webshare = {}
for key, name in [('direct', 'Webshare Direct HTTP'), ('backbone', 'Webshare Backbone HTTP')]:
    node = next(p for p in proxies if p['name'] == name)
    webshare[key] = {k: node[k] for k in ['type', 'server', 'port', 'username', 'password']}
airports = []
for index, (name, provider) in enumerate(config['proxy-providers'].items()):
    nodes = provider.get('payload')
    if not nodes:
        nodes = yaml_read(root / provider['path']).get('proxies', [])
    prefix = provider.get('override', {}).get('additional-prefix', '')
    label = prefix.rstrip('｜') or name.removesuffix('订阅')
    airports.append({'id': f'airport-{index + 1}', 'name': label, 'url': provider['url'], 'nodes': nodes})
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
store = {'version': 1, 'updatedAt': now, 'token': secrets.token_urlsafe(32), 'webshare': webshare, 'airports': airports,
         'defaults': {k: v for k, v in config.items() if k in ['dns', 'sniffer']}}
args.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
target = args.data_dir / 'connections.json'
with open(target, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
    json.dump(store, file, ensure_ascii=False)
print(f'Imported {len(airports)} airports and two Webshare endpoints. Secrets were not printed.')
