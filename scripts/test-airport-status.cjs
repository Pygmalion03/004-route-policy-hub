const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const typescript = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route-hub-airports-'));
process.env.DATA_DIR = directory;
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
const { generateConfiguration, publicConnections, saveConnections, writeConnections, refreshConnections } = require('../lib/connections.ts');

const endpoint = { server: '127.0.0.1', port: 8000, type: 'http', username: 'test', password: 'test' };
const makeStore = () => ({
  version: 1, updatedAt: '2026-01-01T00:00:00Z', token: 'test',
  webshare: { direct: { ...endpoint }, backbone: { ...endpoint } },
  airports: [
    { id: 'old', name: 'Old', url: 'https://old.example/sub', nodes: [{ name: 'old-node', type: 'direct', server: '127.0.0.1' }], enabled: false },
    { id: 'current', name: 'Current', url: 'https://current.example/sub', nodes: [{ name: 'current-node', type: 'direct', server: '127.0.0.1' }], refreshedAt: new Date().toISOString() },
  ],
  vpsNodes: [{ id: 'vps', name: 'VPS', node: { name: 'VPS', type: 'direct', server: '127.0.0.1', port: 8000 } }],
  claude: { mode: 'vps', expectedIp: '192.0.2.1', pinnedAt: '2026-01-01T00:00:00Z', frontName: 'VPS', front: { name: 'VPS', type: 'direct', server: '127.0.0.1', port: 8000 } },
  defaults: { dns: { enable: true, nameserver: ['https://1.1.1.1/dns-query#使用方案'] } },
});

test('disabled airports stay in management but not in either device subscription', async () => {
  const store = makeStore();
  const view = publicConnections(store);
  assert.equal(view.airports.find(a => a.id === 'old').enabled, false);
  for (const client of ['desktop', 'ios']) {
    const config = await generateConfiguration(store, 'https://example.test', client);
    assert.deepEqual(Object.keys(config['proxy-providers']), ['current']);
    assert.deepEqual(config['proxy-groups'].find(g => g.name === '机场节点').use, ['current']);
    assert.ok(config.proxies.some(p => p.name === 'Claude 固定出口｜192.0.2.1'));
  }
});

test('saving or refreshing preserves disabled airport credentials and skips its download', async () => {
  const store = makeStore();
  await writeConnections(store);
  const view = publicConnections(store);
  const old = view.airports.find(a => a.id === 'old');
  delete old.enabled; // Existing clients may omit the new field.
  const saved = await saveConnections(view);
  assert.equal(saved.airports.find(a => a.id === 'old').enabled, false);
  assert.equal(saved.airports.find(a => a.id === 'old').url, 'https://old.example/sub');
  const refreshed = await refreshConnections();
  assert.equal(refreshed.airports.find(a => a.id === 'old').refreshedAt, undefined);
});

test('when all airports are disabled the VPS plans remain usable', async () => {
  const store = makeStore();
  store.airports.forEach(airport => { airport.enabled = false; });
  const config = await generateConfiguration(store, 'https://example.test');
  assert.deepEqual(Object.keys(config['proxy-providers']), []);
  assert.deepEqual(config['proxy-groups'].find(g => g.name === '使用方案').proxies, ['VPS＋Webshare', '只用 VPS']);
  assert.ok(!config['proxy-groups'].some(g => g.name === '机场节点'));
});

test('an airport can be disabled and re-enabled without replacing its subscription', async () => {
  const store = makeStore();
  await writeConnections(store);
  let view = publicConnections(store);
  view.airports.find(a => a.id === 'current').enabled = false;
  let saved = await saveConnections(view);
  assert.equal(saved.airports.find(a => a.id === 'current').enabled, false);
  assert.equal(saved.airports.find(a => a.id === 'current').url, 'https://current.example/sub');
  view = publicConnections(saved);
  view.airports.find(a => a.id === 'current').enabled = true;
  saved = await saveConnections(view);
  const config = await generateConfiguration(saved, 'https://example.test');
  assert.deepEqual(Object.keys(config['proxy-providers']), ['current']);
});

test('Mac defaults persist and older clients cannot erase them', async () => {
  const store = makeStore();
  await writeConnections(store);
  let view = publicConnections(store);
  view.macDefaults = { plan: '只用 VPS', vpsId: 'vps' };
  let saved = await saveConnections(view);
  assert.deepEqual(saved.macDefaults, { plan: '只用 VPS', vpsId: 'vps' });
  view = publicConnections(saved);
  delete view.macDefaults;
  saved = await saveConnections(view);
  assert.deepEqual(saved.macDefaults, { plan: '只用 VPS', vpsId: 'vps' });
  view = publicConnections(saved);
  view.macDefaults = { plan: '只用 VPS', vpsId: 'missing' };
  await assert.rejects(saveConnections(view), /默认 VPS/);
  assert.deepEqual(publicConnections(await refreshConnections()).macDefaults, { plan: '只用 VPS', vpsId: 'vps' });
});
