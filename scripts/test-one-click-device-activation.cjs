const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);
const { activateFromSingleWebChange, ActivationRollbackError } =
  require('../lib/one-click-device-activation.ts');
const d={mac:'02:aa:bb:cc:dd:10',ip:'192.168.50.36',name:'Synthetic Phone'};
function mock(failAt) {
 const calls=[];
 const agent={
  async prepareQ4() {calls.push('prepare');if(failAt==='prepare')throw Error('host offline');return 'ticket-test';},
  async bindRouterToQ4() {calls.push('router-bind');if(failAt==='router-bind')throw Error('router refused');},
  async activateQ4Plan() {calls.push('activate');if(failAt==='activate')throw Error('host not healthy');},
  async restoreRouter() {calls.push('router-restore');if(failAt==='router-restore')throw Error('router restore failed');},
  async abortQ4() {calls.push('host-abort');if(failAt==='host-abort')throw Error('Q4 restore failed');},
 };
 return {calls,agent};
}
test('default direct: zero writes to ZTE and Q4',async()=>{
 const {calls,agent}=mock();
 assert.deepEqual(await activateFromSingleWebChange(d,'direct',agent),{
  outcome:'router-direct',effectivePlan:'direct',q4Managed:false
 });
 assert.deepEqual(calls,[]);
});
test('web-only SG change: Q4 ready BEFORE router write; result awaits DHCP reconnect',async()=>{
 const {calls,agent}=mock();
 assert.deepEqual(await activateFromSingleWebChange(d,'flex',agent),{
  outcome:'awaiting-reconnect',effectivePlan:'flex',q4Managed:true,
 });
 assert.deepEqual(calls,['prepare','router-bind','activate']);
});
test('generic orchestrator preserves plan argument; public strict enrollment remains blocked',async()=>{
 const {calls,agent}=mock();
 assert.equal((await activateFromSingleWebChange(d,'strict',agent)).effectivePlan,'strict');
 assert.deepEqual(calls,['prepare','router-bind','activate']);
});
test('offline Q4: no router write at all',async()=>{
 const {calls,agent}=mock('prepare');
 await assert.rejects(activateFromSingleWebChange(d,'flex',agent),/host offline/);
 assert.deepEqual(calls,['prepare']);
});
test('failed ZTE bind: Q4 prepared entry is aborted',async()=>{
 const {calls,agent}=mock('router-bind');
 await assert.rejects(activateFromSingleWebChange(d,'flex',agent),/router refused/);
 assert.deepEqual(calls,['prepare','router-bind','router-restore','host-abort']);
});
test('plan activation fail: router restored before Q4 abort',async()=>{
 const {calls,agent}=mock('activate');
 await assert.rejects(activateFromSingleWebChange(d,'strict',agent),/host not healthy/);
 assert.deepEqual(calls,['prepare','router-bind','activate','router-restore','host-abort']);
});
test('rollback failure is explicit (no false success)',async()=>{
 const {calls,agent}=mock('router-restore');
 // Force Q4 activation to fail, and router restore to fail.
 agent.activateQ4Plan=async()=>{calls.push('activate');throw Error('fail');};
 await assert.rejects(activateFromSingleWebChange(d,'flex',agent),ActivationRollbackError);
 assert.deepEqual(calls,['prepare','router-bind','activate','router-restore','host-abort']);
});
