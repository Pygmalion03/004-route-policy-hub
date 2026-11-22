const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

const network = require('../lib/home-network.ts');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'home-network-test-'));
process.env.DATA_DIR = directory;
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));

const { draft, vpsNodes, policy } = require('./test-support/home-network-fixture.cjs');
const healthy = { nas: true, la: true, sg: true };

test('LA public traffic ignores direct exceptions and never falls back to SG or broadband', () => {
  for (const match of ['direct', 'proxy', 'default']) {
    assert.equal(network.simulateHomeRoute(draft, 'fixed-la', 'public', healthy, match).exit, 'la');
    assert.equal(network.simulateHomeRoute(draft, 'fixed-la', 'public', { ...healthy, la: false }, match).exit, 'blocked');
    assert.equal(network.simulateHomeRoute({ ...draft, sgDirectFallback: true }, 'fixed-la', 'public', { ...healthy, nas: false }, match).exit, 'blocked');
  }
  assert.equal(network.simulateHomeRoute(draft, 'fixed-la', 'lan', { ...healthy, la: false }).exit, 'lan');
});

test('SG fallback is explicit and NAS failure requires a manual gateway change', () => {
  assert.equal(network.simulateHomeRoute(draft, 'split-sg', 'public', healthy, 'direct').exit, 'broadband');
  assert.equal(network.simulateHomeRoute(draft, 'split-sg', 'public', healthy, 'proxy').exit, 'sg');
  assert.equal(network.simulateHomeRoute(draft, 'split-sg', 'public', { ...healthy, sg: false }).exit, 'blocked');
  const fallback = { ...draft, sgDirectFallback: true };
  assert.equal(network.simulateHomeRoute(fallback, 'split-sg', 'public', { ...healthy, sg: false }).exit, 'broadband');
  const failure = network.simulateHomeRoute(fallback, 'split-sg', 'public', { ...healthy, nas: false });
  assert.equal(failure.exit, 'blocked');
  assert.equal(failure.manualGatewayChange, true);
  assert.equal(network.simulateHomeRoute(draft, 'router-direct', 'public', { nas: false, la: false, sg: false }).exit, 'broadband');
});

test('generated LA resolver and all public routes stay in one fixed LA instance', () => {
  const { la, sg } = network.generateHomeNetwork(draft, vpsNodes, policy);
  assert.deepEqual(la.proxies.map(p => p.server), ['192.0.2.10']);
  assert.equal(la.rules.at(-1), 'MATCH,LA');
  assert.ok(!la.rules.some(rule => rule.includes('hub-direct') || rule.includes('china-')));
  assert.deepEqual(la.dns.nameserver, ['https://1.1.1.1/dns-query#LA']);
  assert.equal(la.dns['nameserver-policy'], undefined);
  assert.equal(la['proxy-groups'], undefined);
  assert.equal(la['external-controller'], undefined);
  assert.notEqual(la['tproxy-port'], sg['tproxy-port']);
  assert.notEqual(la.dns.listen, sg.dns.listen);
  assert.equal(JSON.stringify(la).includes('fixture-sg'), false);
  assert.equal(JSON.stringify(sg).includes('fixture-la'), false);
});

test('SG uses shared network matchers, ignores process matchers, and only enables fallback on request', () => {
  const { sg } = network.generateHomeNetwork(draft, vpsNodes, policy);
  assert.ok(sg.rules.includes('RULE-SET,hub-direct,DIRECT'));
  assert.ok(sg.rules.indexOf('RULE-SET,hub-proxy,SG') < sg.rules.indexOf('RULE-SET,china-domains,DIRECT'));
  assert.deepEqual(sg['rule-providers']['hub-direct'].payload, ['DOMAIN-SUFFIX,example.cn']);
  assert.equal(sg['proxy-groups'], undefined);
  const fallback = network.generateHomeNetwork({ ...draft, sgDirectFallback: true }, vpsNodes, policy).sg;
  assert.deepEqual(fallback['proxy-groups'][0].proxies, ['SG-node', 'DIRECT']);
  assert.equal(fallback['proxy-groups'][0].type, 'fallback');
});

test('rejects missing, conflicting, unsafe or ambiguous bindings before exporting', () => {
  for (const patch of [
    { laVpsId: '' }, { sgVpsId: 'la' }, { nasIp: '192.168.60.2' },
    { lanCidr: '0.0.0.0/0' }, { lanInterface: 'eth0"; flush ruleset' },
    { claude: { ...draft.claude, tailscaleIp: '203.0.113.1' } },
    { devices: [...draft.devices, { ...draft.devices[0], name: 'duplicate' }] },
    { devices: [{ ...draft.devices[0], ip: draft.nasIp }] },
  ]) assert.throws(() => network.generateHomeNetwork({ ...draft, ...patch }, vpsNodes, policy));
  assert.throws(() => network.generateHomeNetwork(draft, [{ ...vpsNodes[0], node: { ...vpsNodes[0].node, server: 'la.example.test' } }, vpsNodes[1]], policy));
  assert.throws(() => network.validateHomeDraft({ ...draft, sgDirectFallback: 'false' }));
});

test('preview excludes node credentials while exported files retain private material', () => {
  const generated = network.generateHomeNetwork(draft, vpsNodes, policy);
  assert.equal(JSON.stringify(network.homeNetworkPreview(generated)).includes('fixture-la'), false);
  assert.equal(JSON.stringify(network.homeNetworkPreview(generated)).includes('fixture-sg'), false);
  assert.ok(generated.files['mihomo-la.yaml'].includes('fixture-la'));
  assert.ok(generated.files['firewall.nft'].includes('tproxy'));
  assert.ok(!generated.files['firewall.nft'].includes('flush ruleset'));
  assert.ok(generated.files['claude-la.command'].includes('developer@100.100.10.20'));
  assert.ok(generated.files['claude-la.command'].includes('-u HTTPS_PROXY'));
});

test('draft writes remain private under DATA_DIR and stale edits cannot overwrite newer data', async () => {
  const empty = await network.readHomeDraft();
  assert.equal(empty.updatedAt, null);
  assert.equal(fs.existsSync(path.join(directory, 'home-network.json')), false);
  const first = await network.saveHomeDraft(draft);
  assert.ok(first.updatedAt);
  await assert.rejects(network.saveHomeDraft(draft), network.HomeDraftConflictError);
  const second = await network.saveHomeDraft({ ...first, sgDirectFallback: true });
  assert.ok(second.updatedAt > first.updatedAt);
  assert.equal((await network.readHomeDraft()).sgDirectFallback, true);
  assert.equal(fs.statSync(path.join(directory, 'home-network.json')).mode & 0o777, 0o600);
});

test('local export writes an unopened private bundle and refuses to overwrite it', async () => {
  const { spawnSync } = require('node:child_process');
  const { parse } = require('yaml');
  fs.writeFileSync(path.join(directory, 'connections.json'), JSON.stringify({ vpsNodes }));
  fs.writeFileSync(path.join(directory, 'policies.json'), JSON.stringify(policy));
  const output = path.join(directory, 'export');
  const args = [path.join(__dirname, 'export-home-network.cjs'), '--output-dir', output];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, DATA_DIR: directory } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('fixture-la'), false);
  assert.equal(fs.statSync(output).mode & 0o777, 0o700);
  for (const filename of fs.readdirSync(output)) assert.equal(fs.statSync(path.join(output, filename)).mode & 0o777, 0o600);
  assert.equal(parse(fs.readFileSync(path.join(output, 'mihomo-la.yaml'), 'utf8')).proxies[0].password, 'fixture-la');
  assert.equal(spawnSync('sh', ['-n', path.join(output, 'claude-la.command')]).status, 0);
  assert.notEqual(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
  if (process.env.MIHOMO_BIN) {
    for (const role of ['la', 'sg']) {
      const check = spawnSync(process.env.MIHOMO_BIN, ['-t', '-d', path.join(directory, `check-${role}`), '-f', path.join(output, `mihomo-${role}.yaml`)], { encoding: 'utf8', timeout: 20000 });
      assert.equal(check.status, 0, check.stdout + check.stderr);
    }
  }
});
