const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);
const { strictEligibility } = require('../lib/oneclick-strict-eligibility.ts');
const verified = { available:true, reason:null };
const unverified = { available:false, reason:'DNS/IPv6 not proven' };

test('new client remains LA-blocked without a privileged Q4 network attestation', () => {
  const result = strictEligibility(unverified, 'SSID7', 'SSID7');
  assert.equal(result.available, false);
  assert.match(result.reason, /DNS/);
});
test('a host attestation alone does not authorize an unknown or different SSID', () => {
  for (const observed of [undefined, '', 'SSID1', 'SSID5']) {
    assert.equal(strictEligibility(verified,'SSID7',observed).available, false);
  }
  assert.equal(strictEligibility(verified,undefined,'SSID7').available, false);
});
test('verified network with exact router-reported interface can enable LA', () => {
  assert.deepEqual(strictEligibility(verified, 'SSID7','SSID7'),verified);
});
