#!/usr/bin/env python3
"""Build a clickable project picker for the existing restricted Claude launcher."""
from pathlib import Path
import json
import plistlib
import subprocess

root = Path(__file__).resolve().parent
app = Path.home()/'Applications/Claude 项目启动器.app'
contents = app/'Contents'
for name in ['MacOS', 'Resources']:
    (contents/name).mkdir(parents=True, exist_ok=True)
config = contents/'Resources/launcher.json'
config.write_text(json.dumps({'script': str(root/'claude-safe.command'), 'workspace': str(root/'claude-workspace.py'), 'defaultWorkspace': str(root.parent/'.claude-workspaces/claude')}, ensure_ascii=False))
config.chmod(0o600)
with (contents/'Info.plist').open('wb') as f:
    plistlib.dump({'CFBundleIdentifier': 'top.pygmalion.claude-project', 'CFBundleName': 'Claude 项目启动器', 'CFBundleExecutable': 'ClaudeProject', 'CFBundlePackageType': 'APPL', 'CFBundleVersion': '1', 'NSHighResolutionCapable': True}, f)
subprocess.run(['/usr/bin/swiftc', str(root/'claude-project.swift'), '-o', str(contents/'MacOS/ClaudeProject'), '-framework', 'AppKit'], check=True)
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], check=True, capture_output=True)
print('已创建本机应用：'+str(app))
