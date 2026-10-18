#!/usr/bin/env python3
"""Ask the external launcher before file tools leave the session's granted paths.

This hook does not inspect shell programs. The outer OS profile enforces those.
Only paths and tool names enter the request; file contents never do.
"""
import json
import os
from pathlib import Path
import sys
import uuid


def contained(path, root):
    return path == root or root in path.parents


def request_for(event, project, grants):
    tool = event.get('tool_name', '')
    value = event.get('tool_input', {})
    if tool not in ['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep']:
        return None
    target = value.get('file_path') or value.get('notebook_path') or value.get('path')
    if not target and tool == 'Glob' and value.get('pattern', '').startswith(('/', '~/')):
        prefix = value['pattern']
        for wildcard in ['*', '?', '[', '{']:
            prefix = prefix.split(wildcard, 1)[0]
        target = prefix if prefix.endswith('/') else str(Path(prefix).parent)
    target = target or str(project)
    path = Path(target).expanduser()
    if not path.is_absolute():
        path = project / path
    path = path.resolve()
    access = 'write' if tool in ['Edit', 'Write', 'NotebookEdit'] else 'read'
    if contained(path, project):
        return None
    for grant in grants:
        root = Path(grant['path'])
        if (path == root or (grant['directory'] and contained(path, root))) and (access == 'read' or grant['access'] == 'write'):
            return None
    # System toolchain files remain readable. Personal files on any volume require approval.
    if access == 'read' and any(contained(path, Path(root)) for root in ['/System', '/usr', '/bin', '/sbin', '/opt/homebrew', '/Library/Developer']):
        return None
    return {'path': str(path), 'access': access, 'tool': tool}


def main():
    event = json.load(sys.stdin)
    session = Path(os.environ['CLAUDE_SAFE_SESSION'])
    config = json.loads((session/'scope.json').read_text())
    request = request_for(event, Path(config['project']), config['grants'])
    if not request:
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'allow',
            'permissionDecisionReason': '操作位于工作区或本次会话已批准范围。'}}))
        return
    session_id = str(uuid.UUID(event['session_id']))
    if session_id != config['session_id']:
        raise ValueError('session mismatch')
    if [request['path'], request['access']] in config.get('denied', []):
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
            'permissionDecisionReason': '本人已拒绝本次会话访问此路径，请使用工作区中的资料。'}}))
        return
    request['session_id'] = session_id
    requests = session/'requests'
    path = requests/(uuid.uuid4().hex+'.json')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(request, ensure_ascii=False))
    temporary.chmod(0o600)
    temporary.replace(path)
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
        'permissionDecisionReason': '已向本机项目启动器申请访问 '+request['path']+'。等待本人批准；批准后启动器恢复本次会话，请重试原操作。'}} ,ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
            'permissionDecisionReason': '权限检查未就绪，请从 Claude 项目启动器重新启动。'}}))
