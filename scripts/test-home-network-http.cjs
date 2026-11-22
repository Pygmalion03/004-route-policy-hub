// Uses a real local Next server with temporary synthetic data. Never connects to a VPS.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { draft, vpsNodes, policy } = require('./test-support/home-network-fixture.cjs');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'home-network-http-'));
  fs.writeFileSync(path.join(directory, 'connections.json'), JSON.stringify({
    vpsNodes, airports: [], token: 'fixture-subscription', updatedAt: policy.updatedAt,
    webshare: { direct: { type: 'http', server: '192.0.2.30', port: 8000 } },
    defaults: { dns: { enable: true, nameserver: ['https://1.1.1.1/dns-query#使用方案'] } },
  }));
  fs.writeFileSync(path.join(directory, 'policies.json'), JSON.stringify(policy));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [
    path.join(__dirname, '../node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATA_DIR: directory, ADMIN_PASSWORD: 'fixture-admin', PUBLIC_BASE_URL: origin, LAN_MANAGEMENT_HOST: `127.0.0.1:${port}`, ZTE_ROUTER_URL: '', ZTE_ROUTER_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = () => { server.kill('SIGTERM'); fs.rmSync(directory, { recursive: true, force: true }); };
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  let output = '';
  server.stdout.on('data', data => { output += data; });
  server.stderr.on('data', data => { output += data; });
  try {
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${origin}/home-network`)).ok) break; } catch {}
      if (attempt > 100 || server.exitCode !== null) throw new Error(`测试服务器未启动：${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const request = (method, body, password = 'fixture-admin') => fetch(`${origin}/api/home-network`, {
      method, headers: { 'content-type': 'application/json', 'x-admin-password': password },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const method of ['GET', 'PUT', 'POST']) {
      assert.equal((await request(method, method === 'GET' ? undefined : draft, '')).status, 401);
      assert.equal((await request(method, method === 'GET' ? undefined : draft, 'wrong')).status, 401);
    }
    for (const route of ['/home-network', '/api/home-network/devices', '/api/home-network/devices/apply', '/subscription/device', '/subscription/plan']) {
      assert.equal((await fetch(`${origin}${route}`, { headers: { 'cf-ray': 'fixture-public-edge' } })).status, 404);
    }
    assert.equal((await fetch(`${origin}/rules/direct.yaml`, { headers: { 'cf-ray': 'fixture-public-edge' } })).status, 200);
    assert.equal(fs.existsSync(path.join(directory, 'home-network.json')), false);
    const initial = await request('GET');
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    const initialText = await initial.text();
    assert.equal(initialText.includes('fixture-la'), false);
    assert.equal(JSON.parse(initialText).draft.updatedAt, null);
    assert.equal(JSON.parse(initialText).policy.policies[0].name, 'Direct fixture');
    const saved = await request('PUT', draft);
    assert.equal(saved.status, 200);
    const current = (await saved.json()).draft;
    assert.equal((await request('PUT', draft)).status, 409);
    const preview = await request('POST', { action: 'preview', draft: current });
    assert.equal(preview.status, 200);
    const text = await preview.text();
    assert.equal(text.includes('fixture-la'), false);
    assert.equal(text.includes('fixture-sg'), false);
    assert.equal(JSON.parse(text).status, 'draft-not-applied');
    assert.equal((await request('POST', { action: 'download', draft: current, file: '../connections.json' })).status, 400);
    assert.equal((await request('POST', { action: 'download', draft: current, file: 'mihomo-la.yaml' }, '')).status, 401);
    const download = await request('POST', { action: 'download', draft: current, file: 'mihomo-la.yaml' });
    assert.equal(download.status, 200);
    assert.ok(download.headers.get('content-disposition').startsWith('attachment'));
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.ok((await download.text()).includes('fixture-la'));
    for (const action of ['direct', 'proxy']) {
      const rules = await fetch(`${origin}/rules/${action}.yaml`);
      assert.equal(rules.status, 200);
      assert.ok((await rules.text()).includes(action === 'direct' ? 'example.cn' : 'example.org'));
    }
    const writePolicy = (body, password = '') => fetch(`${origin}/api/policies`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-admin-password': password }, body: JSON.stringify(body),
    });
    const copyPlan = (client, password = '') => fetch(`${origin}/api/connections?client=${client}`, {
      method: 'POST', headers: { 'x-admin-password': password },
    });
    assert.equal((await writePolicy(policy)).status, 401);
    assert.equal((await copyPlan('strict-mac')).status, 401);
    assert.equal((await copyPlan('strict-mac', 'fixture-admin')).status, 409);
    const changed = { ...policy, strictVpsId: 'la', flexDirectFallback: true, policies: policy.policies.map(item => ({ ...item, action: 'PROXY' })) };
    assert.equal((await writePolicy(changed, 'fixture-admin')).status, 200);
    assert.equal((await writePolicy(policy, 'fixture-admin')).status, 409);
    assert.ok((await (await fetch(`${origin}/rules/proxy.yaml`)).text()).includes('example.cn'));
    assert.ok(!(await (await fetch(`${origin}/rules/direct.yaml`)).text()).includes('example.cn'));
    assert.equal((await fetch(`${origin}/subscription/plan?token=fixture-subscription`)).status, 404);
    assert.equal((await fetch(`${origin}/subscription?token=fixture-subscription&client=strict-mac`)).status, 404);
    for (const client of ['strict-mac', 'strict-ios', 'flex']) {
      const link = await copyPlan(client, 'fixture-admin');
      assert.equal(link.status, 200);
      const { url } = await link.json();
      assert.equal(new URL(url).pathname, '/subscription/plan');
      const subscription = await fetch(url);
      assert.equal(subscription.status, 200);
      const route = await subscription.json();
      if (client === 'flex') {
        assert.deepEqual(route['proxy-groups'].find(group => group.name === '日常线路与兜底').proxies, ['使用方案', 'DIRECT']);
      } else {
        assert.deepEqual(route['proxy-groups'][0].proxies, ['自建 VPS｜Los Angeles (test)']);
        assert.equal(route.proxies.length, 1);
        assert.equal(route.tun['strict-route'], true);
      }
      if (process.env.MIHOMO_BIN) {
        const configFile = path.join(directory, `${client}.json`);
        fs.writeFileSync(configFile, JSON.stringify(route));
        const check = spawnSync(process.env.MIHOMO_BIN, ['-t', '-d', path.join(directory, client), '-f', configFile], { encoding: 'utf8', timeout: 20000 });
        assert.equal(check.status, 0, check.stdout + check.stderr);
      }
    }
    const devices = `${origin}/api/home-network/devices`;
    const deviceHeaders = { 'x-admin-password': 'fixture-admin', 'content-type': 'application/json' };
    const requestDevice = (method, body) => fetch(devices, {
      method, headers: deviceHeaders, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const method of ['GET', 'PUT', 'POST', 'PATCH']) assert.equal((await fetch(devices, { method })).status, 401);
    assert.equal((await fetch(`${devices}/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mac: '02:00:00:00:00:10', revision: 1 }) })).status, 401);
    const mac = '02:00:00:00:00:10';
    assert.equal((await requestDevice('PUT', { mac, plan: 'strict' })).status, 404);
    assert.equal((await requestDevice('PATCH', { mac, revision: 1, verified: true })).status, 404);
    assert.equal((await requestDevice('PATCH', { mac, revision: '1', verified: true })).status, 400);
    const key = '11111111-2222-4333-8444-555555555555';
    fs.writeFileSync(path.join(directory, 'device-assignments.json'), JSON.stringify([
      { mac, key, name: 'Synthetic device', plan: 'flex', revision: 1, downloadedRevision: null, downloadedAt: null },
    ]));
    const roster = await (await requestDevice('GET')).text();
    assert.ok(roster.includes('Synthetic device'));
    assert.ok(!roster.includes(key));
    const controllerView = JSON.parse(roster).controller;
    assert.equal(controllerView.available, false, 'without host controller, no device may claim actual application');
    // Saving a plan does not authorize host control of this synthetic device.
    const unauthorizedApply = await fetch(`${devices}/apply`, {
      method: 'POST', headers: deviceHeaders, body: JSON.stringify({ mac, revision: 1 }),
    });
    assert.equal(unauthorizedApply.status, 403, 'an unrecognized host identity must be denied before execution');
    assert.deepEqual(await unauthorizedApply.json(), {
      error: '该设备尚未被授权实际切换。为防影响其他设备，不能下发。',
    });
    const { path: deviceSubscription } = await (await requestDevice('POST', { mac, platform: 'ios' })).json();
    assert.equal((await fetch(`${origin}/subscription/device?key=invalid&platform=ios`)).status, 401);
    for (const plan of ['strict', 'direct', 'flex']) {
      const choice = await (await requestDevice('PUT', { mac, plan })).json();
      assert.equal(choice.selection.plan, plan);
      assert.equal(choice.selection.fetched, false);
      assert.equal(choice.selection.verified, false, 'editing a plan invalidates old verification');
      assert.equal(choice.selection.verifiedAt, null);
      const revision = choice.selection.revision;
      assert.ok(Number.isSafeInteger(revision));
      assert.equal((await requestDevice('PATCH', { mac, revision: revision - 1, verified: true })).status, 409);
      const checked = await requestDevice('PATCH', { mac, revision, verified: true });
      assert.equal(checked.status, 200);
      const checkResult = await checked.json();
      assert.equal(checkResult.selection.verified, true);
      assert.ok(checkResult.selection.verifiedAt);
      assert.ok(!JSON.stringify(checkResult).includes(key), 'manual verification never returns a subscription key');
      const config = await (await fetch(`${origin}${deviceSubscription}`)).json();
      if (plan === 'strict') assert.deepEqual(config['proxy-groups'][0].proxies, ['自建 VPS｜Los Angeles (test)']);
      if (plan === 'direct') assert.deepEqual(config.rules, ['MATCH,DIRECT']);
      if (plan === 'flex') assert.ok(config['proxy-groups'].some(group => group.name === '日常线路与兜底'));
      const currentSelection = (await (await requestDevice('GET')).json()).devices[0].selection;
      assert.equal(currentSelection.plan, plan);
      assert.equal(currentSelection.revision, revision);
      assert.equal(currentSelection.fetched, true);
      assert.equal(currentSelection.verified, true);
      if (plan === 'direct') {
        const revoked = await (await requestDevice('PATCH', { mac, revision, verified: false })).json();
        assert.equal(revoked.selection.verified, false);
        assert.equal(revoked.selection.verifiedAt, null);
      }
    }
    console.log('真实本地 HTTP 验证通过：受保护的规则修改与方案订阅、草稿冲突、脱敏预览、私有下载与两个只读规则端点。');
    if (process.argv.includes('--keep-running')) {
      console.log(`临时测试预览：${origin}/home-network\n测试密码：fixture-admin\n仅使用测试节点。按 Ctrl+C 关闭并清理。`);
      await once(server, 'exit');
    }
  } finally { cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
