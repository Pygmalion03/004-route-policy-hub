const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const typescript = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};

const { generateConfiguration } = require('../lib/connections.ts');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'route-hub-dns-'));
process.env.DATA_DIR = directory;
process.on('exit', () => fs.rmSync(directory, { recursive: true, force: true }));

const defaultDns = 'https://1.1.1.1/dns-query#使用方案';
const store = {
  version: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  token: 'test',
  webshare: {
    direct: { name: 'test', type: 'http', server: '127.0.0.1', port: 8000, username: 'u', password: 'p' },
    backbone: { name: 'test', type: 'http', server: '127.0.0.1', port: 8000, username: 'u', password: 'p' },
  },
  airports: [],
  vpsNodes: [{ id: 'test', name: 'test', node: { name: 'test', type: 'direct', server: '127.0.0.1', port: 8000 } }],
  claude: {
    mode: 'vps', expectedIp: '192.0.2.1', pinnedAt: '2026-01-01T00:00:00Z',
    frontName: 'test', front: { name: 'test', type: 'direct', server: '127.0.0.1', port: 8000 },
  },
  defaults: { dns: { enable: true, nameserver: [defaultDns] } },
};

test('desktop DNS follows direct and proxy exceptions before China domains', async () => {
  const config = await generateConfiguration(store, 'https://example.test');
  const dns = config.dns;
  const policy = dns['nameserver-policy'];
  assert.deepEqual(Object.keys(policy), ['rule-set:hub-direct', 'rule-set:hub-proxy', 'rule-set:china-domains']);
  assert.deepEqual(policy['rule-set:hub-direct'], [
    'https://doh.pub/dns-query#DIRECT', 'https://dns.alidns.com/dns-query#DIRECT',
  ]);
  assert.deepEqual(policy['rule-set:hub-proxy'], [defaultDns]);
  assert.deepEqual(policy['rule-set:china-domains'], policy['rule-set:hub-direct']);
  assert.deepEqual(dns.nameserver, [defaultDns]);
});

test('iPhone Claude DNS and routing remain fixed', async () => {
  const config = await generateConfiguration(store, 'https://example.test', 'ios');
  assert.deepEqual(config.dns.nameserver, ['https://1.1.1.1/dns-query#Claude 固定出口｜192.0.2.1']);
  assert.equal(config.dns['nameserver-policy'], undefined);
  assert.equal(config.rules[0], 'DOMAIN-SUFFIX,claude.ai,Claude 固定出口｜192.0.2.1');
});

test('Mac override keeps its original proxy DNS and strips automatic China routing', () => {
  const config = {
    dns: {
      nameserver: [defaultDns],
      'nameserver-policy': {
        'rule-set:hub-direct': ['domestic'],
        'rule-set:hub-proxy': [defaultDns],
        'rule-set:china-domains': ['domestic'],
      },
    },
    rules: ['RULE-SET,china-domains,DIRECT', 'RULE-SET,china-ips,DIRECT', 'MATCH,使用方案'],
  };
  const context = vm.createContext({ config });
  const source = fs.readFileSync(path.join(__dirname, 'mac-routing.js'), 'utf8');
  vm.runInContext(`${source}\nmain(config);`, context);
  assert.deepEqual(config.dns.nameserver, [defaultDns]);
  assert.deepEqual(config.dns['nameserver-policy'], {});
  assert.ok(!config.rules.some(rule => rule.startsWith('RULE-SET,china-')));
  assert.ok(config.rules.includes('MATCH,使用方案'));
});
