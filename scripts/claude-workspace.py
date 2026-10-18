#!/usr/bin/env python3
"""Create a Claude-only local checkout from committed code; never copy secrets."""
import argparse
import re
from pathlib import Path
import subprocess


def prepare(source, name='claude'):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', name):
        raise ValueError('工作区名称使用小写字母、数字和短横线。')
    source = source.resolve()
    subprocess.run(['git', '-C', str(source), 'rev-parse', '--verify', 'HEAD'], check=True, capture_output=True)
    top = subprocess.run(['git', '-C', str(source), 'rev-parse', '--show-toplevel'], check=True, capture_output=True, text=True).stdout.strip()
    source = Path(top)
    if '.claude-workspaces' in source.parts:
        raise ValueError('请选择原始项目，不要在 Claude 副本中再创建副本。')
    workspace = source/'.claude-workspaces'/name
    if workspace.exists():
        if not (workspace/'.git').is_dir():
            raise ValueError('Claude 工作区路径已存在且不是独立仓库，不覆盖。')
        return workspace
    exclude = subprocess.run(['git', '-C', str(source), 'rev-parse', '--git-path', 'info/exclude'], check=True, capture_output=True, text=True).stdout.strip()
    exclude = Path(exclude) if Path(exclude).is_absolute() else source/exclude
    exclude.parent.mkdir(parents=True, exist_ok=True)
    content = exclude.read_text() if exclude.exists() else ''
    if '/.claude-workspaces/' not in content.splitlines():
        exclude.write_text(content+'\n/.claude-workspaces/\n')
    subprocess.run(['git', 'clone', '--no-hardlinks', '--quiet', str(source), str(workspace)], check=True, capture_output=True)
    branch = 'codex/claude-workspace' if name == 'claude' else 'codex/claude-'+name
    subprocess.run(['git', '-C', str(workspace), 'switch', '-c', branch], check=True, capture_output=True)
    remote = subprocess.run(['git', '-C', str(source), 'remote', 'get-url', 'origin'], capture_output=True, text=True)
    if remote.returncode == 0:
        subprocess.run(['git', '-C', str(workspace), 'remote', 'set-url', 'origin', remote.stdout.strip()], check=True, capture_output=True)
    return workspace


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--name', default='claude')
    args = parser.parse_args()
    try:
        print(prepare(args.source, args.name))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error) if isinstance(error, ValueError) else '无法创建独立工作区，请确认项目已有 Git 提交。')
