// Private control-plane contract tests. Uses a temporary Unix socket, never Q4.
const assert = require('node:assert/strict');
const { createServer } = require('node:net');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { once } = require('node:events');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

test('runtime controller is unavailable without the Q4 host socket; never claims an applied plan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rph-no-controller-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    const bridge = require('../lib/device-runtime-control.ts');
    assert.deepEqual(await bridge.getRuntimeStatus(), {
      available: false,
      reason: '宿主机控制器未连接；当前只能保存计划，不能实际应用线路。',
    });
    await assert.rejects(bridge.applyRuntimePlan('02:aa:bb:cc:dd:01', 1, 'strict'), { name: 'Error', message: '该设备尚未安装或授权 Q4 实际控制' });
    await assert.rejects(bridge.applyRuntimePlan('02:aa:bb:cc:dd:01', 0, 'strict'), /无效/);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('actual apply requires a matching managed MAC, server-side revision and host acknowledgement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rph-host-fixture-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  const socket = join(root, '.rph-magic8-control.sock');
  const requestLog = [];
  const server = createServer(peer => {
    let buffer = '';
    peer.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.split('\n')[0]);
      requestLog.push(request);
      const state = {
        managedMac: '02:aa:bb:cc:dd:01', managedIp: '192.168.50.29',
        activePlan: request.op === 'apply' ? request.plan : 'flex',
        appliedRevision: request.op === 'apply' ? request.revision : 1,
        appliedAt: '2026-11-22T16:00:00+08:00', status: 'active', reason: null,
      };
      peer.end(JSON.stringify({ ok: true, state }) + '\n');
    });
  });
  try {
    server.listen(socket);
    await once(server, 'listening');
    const bridge = require('../lib/device-runtime-control.ts');
    const status = await bridge.getRuntimeStatus();
    assert.equal(status.available, true);
    assert.equal(status.activePlan, 'flex');
    await assert.rejects(bridge.applyRuntimePlan('02:aa:bb:cc:dd:99', 1, 'strict'), { name: 'Error', message: '该设备尚未安装或授权 Q4 实际控制' });
    assert.equal(requestLog.some(item => item.op === 'apply'), false);
    const next = await bridge.applyRuntimePlan('02:aa:bb:cc:dd:01', 3, 'strict');
    assert.equal(next.activePlan, 'strict');
    assert.equal(next.appliedRevision, 3);
    assert.deepEqual(requestLog.at(-1), { op: 'apply', mac: '02:aa:bb:cc:dd:01', revision: 3, plan: 'strict' });
    assert.equal(requestLog.length, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('host replies without a complete validated state must not count as a successful apply', async () => {
  const { validateRuntimeState } = require('../lib/device-runtime-control.ts');
  assert.throws(() => validateRuntimeState({
    managedMac: '02:aa:bb:cc:dd:01', managedIp: '192.168.50.29',
    activePlan: 'strict', appliedRevision: null, appliedAt: null, status: 'done', reason: null,
  }), /状态格式不匹配/);
  assert.throws(() => validateRuntimeState({
    managedMac: '02:aa:bb:cc:dd:01', managedIp: '192.168.50.29',
    activePlan: 'strict', appliedRevision: 0, appliedAt: null, status: 'active', reason: null,
  }), /状态格式不匹配/);
});
