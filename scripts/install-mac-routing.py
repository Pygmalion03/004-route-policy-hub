#!/usr/bin/env python3
"""Install a subscription-specific Mac script, without changing NAS routing."""
import json
from pathlib import Path
import shutil
import subprocess
import time

root = Path(__file__).resolve().parent
base = Path.home()/'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev'
r = subprocess.run(['/usr/bin/ruby', '-ryaml', '-rjson', '-e',
                    'puts JSON.generate(YAML.load_file(ARGV[0]))', str(base/'profiles.yaml')],
                   capture_output=True, text=True, check=True)
profiles = json.loads(r.stdout)
current = next(p for p in profiles['items'] if p['uid'] == profiles['current'])
script = next(p for p in profiles['items'] if p['uid'] == current['option']['script'])
target = base/'profiles'/script['file']
original = target.read_text()
if original.strip() and 'Route Policy Hub:' not in original and original.strip() != '// Define main function (script entry)\n\nfunction main(config, profileName) {\n  return config;\n}':
    raise SystemExit('当前订阅有自定义脚本，请先合并，不自动覆盖。')
backup = root.parent/'data/usability-backup'/('mac-routing-'+str(time.time_ns()))
backup.mkdir(parents=True, mode=0o700)
shutil.copy2(target, backup/target.name)
shutil.copy2(root/'mac-routing.js', target)
print('已安装当前订阅的 Mac 专用规则。请在 Clash 点击「重新激活订阅」。')
