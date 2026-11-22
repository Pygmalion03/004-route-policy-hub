const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

test('router XML supplies the online and offline rows, not demo devices or Mesh entries', () => {
  const { parseZteDevices } = require('../lib/lan-devices.ts');
  const row = values => `<Instance>${Object.entries(values).map(([key, value]) => `<ParaName>${key}</ParaName><ParaValue>${value}</ParaValue>`).join('')}</Instance>`;
  const online = { MACAddress: '02:AA:BB:CC:DD:01', Active: 1, IPAddress: '192.168.50.12', HostName: 'Computer', DevName: '电脑 &amp; 工作', InterfaceType: 1 };
  const offline = { MACAddress: '02:AA:BB:CC:DD:02', Active: 0, IPAddress: '0.0.0.0', HostName: 'Phone' };
  const xml = `<ajax_response_xml_root><OBJ_LAN_INFO_ID>${row(offline)}${row(online)}${row({ ...online, Active: 0 })}${row({ ...online, MACAddress: '02:AA:BB:CC:DD:03', DevMeshType: 2 })}</OBJ_LAN_INFO_ID></ajax_response_xml_root>`;
  assert.deepEqual(parseZteDevices(xml).map(({ mac, name, ip, online, link }) => [mac, name, ip, online, link]), [
    ['02:aa:bb:cc:dd:01', '电脑 & 工作', '192.168.50.12', true, '有线'],
    ['02:aa:bb:cc:dd:02', 'Phone', '', false, ''],
  ]);
  assert.throws(() => parseZteDevices('<html>Session expired</html>'));
});

test('per-device selection stays private, unaffected devices remain unchanged, and old downloads do not acknowledge new plans', async () => {
  const { assignDevice, findDeviceAssignment, listDeviceAssignments, recordDeviceDownload } = require('../lib/device-assignments.ts');
  const directory = mkdtempSync(join(tmpdir(), 'route-device-test-'));
  process.env.DATA_DIR = directory;
  try {
    const computer = { mac: '02:aa:bb:cc:dd:01', name: 'Computer' };
    const phone = { mac: '02:aa:bb:cc:dd:02', name: 'Phone' };
    const first = await assignDevice(computer, 'flex');
    const second = await assignDevice(phone, 'strict');
    const updated = await assignDevice(computer, 'direct');
    assert.equal(updated.key, first.key);
    assert.equal((await findDeviceAssignment(second.key)).plan, 'strict');
    await recordDeviceDownload(first);
    assert.equal((await findDeviceAssignment(first.key)).downloadedRevision, null);
    await recordDeviceDownload(updated);
    const stored = await listDeviceAssignments();
    assert.equal(stored.find(device => device.mac === computer.mac).downloadedRevision, updated.revision);
    assert.equal(await findDeviceAssignment('not-a-key'), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('manual verification is revision-bound, reversible, and independent of subscription downloads', async () => {
  const {
    assignDevice, devicePlanState, findDeviceAssignment, recordDeviceVerification,
    DeviceVerificationConflictError, DeviceAssignmentNotFoundError,
  } = require('../lib/device-assignments.ts');
  const directory = mkdtempSync(join(tmpdir(), 'route-verification-test-'));
  process.env.DATA_DIR = directory;
  try {
    const device = { mac: '02:aa:bb:cc:dd:03', name: 'Synthetic phone' };
    const first = await assignDevice(device, 'flex');
    assert.deepEqual(devicePlanState(first), {
      plan: 'flex', fetched: false, revision: 1, verified: false, verifiedAt: null,
    });
    const verified = await recordDeviceVerification(device.mac, first.revision, true);
    assert.equal(devicePlanState(verified).verified, true);
    assert.ok(devicePlanState(verified).verifiedAt);
    assert.equal((await findDeviceAssignment(first.key)).key, first.key);
    await assert.rejects(recordDeviceVerification(device.mac, 0, true), DeviceVerificationConflictError);
    const changed = await assignDevice(device, 'strict');
    assert.equal(changed.key, first.key);
    assert.equal(devicePlanState(changed).verified, false);
    assert.equal(devicePlanState(changed).verifiedAt, null);
    await assert.rejects(recordDeviceVerification(device.mac, first.revision, true), DeviceVerificationConflictError);
    const reverified = await recordDeviceVerification(device.mac, changed.revision, true);
    assert.equal(devicePlanState(reverified).verified, true);
    const revoked = await recordDeviceVerification(device.mac, changed.revision, false);
    assert.equal(devicePlanState(revoked).verified, false);
    assert.equal(devicePlanState(revoked).verifiedAt, null);
    await assert.rejects(recordDeviceVerification('02:aa:bb:cc:dd:99', 1, true), DeviceAssignmentNotFoundError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
