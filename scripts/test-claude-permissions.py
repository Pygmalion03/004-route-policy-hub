#!/usr/bin/env python3
"""Account-free checks for file scopes, hook requests, and OS enforcement."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


permissions = module('permissions', 'claude-permissions.py')
network = module('network', 'claude-network.py')


class PermissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT.parent/'data', prefix='permissions-test-')
        self.base = Path(self.temp.name).resolve()
        self.project = self.base/'workspace'
        self.project.mkdir()
        self.outside = self.base/'reference.txt'
        self.outside.write_text('non-sensitive test fixture')

    def tearDown(self):
        self.temp.cleanup()

    def event(self, path, tool='Read'):
        return {'tool_name': tool, 'tool_input': {'file_path': str(path)}, 'session_id': str(uuid.uuid4())}

    def test_workspace_edit_and_symlink_escape(self):
        self.assertIsNone(permissions.request_for(self.event(self.project/'new.txt', 'Write'), self.project, []))
        link = self.project/'linked.txt'
        link.symlink_to(self.outside)
        request = permissions.request_for(self.event(link), self.project, [])
        self.assertEqual(request['path'], str(self.outside))

    def test_read_grant_does_not_grant_write(self):
        grant = {'path': str(self.outside), 'access': 'read', 'directory': False}
        self.assertIsNone(permissions.request_for(self.event(self.outside), self.project, [grant]))
        self.assertEqual(permissions.request_for(self.event(self.outside, 'Write'), self.project, [grant])['access'], 'write')

    def test_absolute_glob_requests_external_directory(self):
        event = {'tool_name': 'Glob', 'tool_input': {'pattern': str(self.base/'*.txt')}}
        self.assertEqual(permissions.request_for(event, self.project, [])['path'], str(self.base))

    def test_hook_only_queues_metadata(self):
        session = self.base/'session'
        (session/'requests').mkdir(parents=True)
        event = self.event(self.outside, 'Write')
        event['tool_input']['content'] = 'NEVER_QUEUE_FILE_CONTENT'
        (session/'scope.json').write_text(json.dumps({'project': str(self.project), 'grants': [], 'session_id': event['session_id']}))
        env = dict(os.environ, CLAUDE_SAFE_SESSION=str(session))
        result = subprocess.run(['/usr/bin/python3', '-I', str(ROOT/'claude-permissions.py')], input=json.dumps(event), capture_output=True, text=True, env=env, check=True)
        self.assertEqual(json.loads(result.stdout)['hookSpecificOutput']['permissionDecision'], 'deny')
        requests = list((session/'requests').glob('*.json'))
        self.assertEqual(len(requests), 1)
        self.assertNotIn('NEVER_QUEUE_FILE_CONTENT', requests[0].read_text())

    def test_os_read_only_grant_and_revocation(self):
        def execute(policy, code):
            return subprocess.run(network.sandbox_command(policy, ['/usr/bin/python3', '-c', code]), cwd=self.project, capture_output=True).returncode
        read = 'open('+repr(str(self.outside))+').read()'
        write = 'open('+repr(str(self.outside))+',"w").write("changed")'
        self.assertNotEqual(execute(network.profile(self.project), read), 0)
        grant = {'path': str(self.outside), 'access': 'read', 'directory': False}
        policy = network.profile(self.project, [grant])
        self.assertEqual(execute(policy, read), 0)
        self.assertNotEqual(execute(policy, write), 0)
        self.assertNotEqual(execute(network.profile(self.project), read), 0)
        self.assertEqual(self.outside.read_text(), 'non-sensitive test fixture')


if __name__ == '__main__':
    unittest.main()
