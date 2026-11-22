const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop:true, target:ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);

const { validateDirectCandidate } =
  require('../lib/direct-onboarding.ts');
const mac='02:aa:bb:cc:dd:10', ip='192.168.50.36';
const config = { version:1, lanCidr:'192.168.50.0/24', gatewayIp:'192.168.50.7',
  routerIp:'192.168.50.1', reservedIps:['192.168.50.1','192.168.50.2','192.168.50.7'],
  wifiInterfaceAlias:'SSID7' };
const device = (overrides={}) => ({
  mac, ip, name:'NewPhone', link:'Wi-Fi', online:true, ...overrides,
});
const snapshot = (rows=[device()],overrides={}) => ({
  status:'live', observedAt:new Date().toISOString(), devices:rows, ...overrides,
});

test('new dedicated Wi-Fi device starts as DIRECT (without router/Q4 changes)',()=>{
 const d=device({wifiInterfaceAlias:'SSID7'});
 const c=validateDirectCandidate(snapshot([d]),mac,ip,new Set(),true,config);
 assert.equal(c.evidence,'router-interface');
 assert.equal(c.device.ip,ip);
});

test('unconfirmed/ambiguous main Wi-Fi, wired, offline, outdated or reserved identity cannot enroll',()=>{
 const deny=(snap, mac0=mac, ip0=ip, set=new Set(), confirmed=true) =>
   assert.throws(()=>validateDirectCandidate(snap,mac0,ip0,set,confirmed,config));
 deny(snapshot(),mac,ip,new Set(),false);
 deny(snapshot([device({wifiInterfaceAlias:'SSID5'})]));
 deny(snapshot([device({link:'有线'})]));
 deny(snapshot([device({online:false})]));
 deny(snapshot([device({ip:'192.168.50.37'})]));
 deny(snapshot(),mac,ip,new Set([mac]));
 deny(snapshot([device({ip:'192.168.50.2'})]),mac,'192.168.50.2');
 deny(snapshot([device(),device({mac:'02:aa:bb:cc:dd:11'})]));
 deny(snapshot([device()], { observedAt: new Date(Date.now() - 65_000).toISOString() }));
});

test('absent SSID marker must have explicit owner attestation, never assert SSID7',()=>{
 const c=validateDirectCandidate(snapshot(),mac,ip,new Set(),true,config);
 assert.equal(c.evidence,'explicit-web-selection');
});

test('invalid, missing or future observation times cannot authorize enrollment',()=>{
 const invalidTimes=[null,undefined,'','not-a-date',new Date(Date.now()+60_000).toISOString()];
 for (const observedAt of invalidTimes) {
  assert.throws(()=>validateDirectCandidate(
    snapshot([device()],{observedAt}),mac,ip,new Set(),true,config,
  ),/设备名单不新鲜/);
 }
});

test('dedicated interface comes from private configuration, not a fixed SSID',()=>{
 const selected={...config,wifiInterfaceAlias:'SSID3'};
 const d=device({wifiInterfaceAlias:'SSID3'});
 assert.equal(validateDirectCandidate(snapshot([d]),mac,ip,new Set(),true,selected).evidence,'router-interface');
 assert.throws(()=>validateDirectCandidate(
  snapshot([device({wifiInterfaceAlias:'SSID7'})]),mac,ip,new Set(),true,selected,
 ),/专用 Wi-Fi 接口/);
});
