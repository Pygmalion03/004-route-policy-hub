const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop:true, target:ts.ScriptTarget.ES2022 },
  }).outputText, filename,
);
const admin = require('../lib/zte-router-admin.ts');
const { createZteBindingTransaction } = require('../lib/zte-oneclick-binding.ts');
const { readOneClickNetworkConfig } = require('../lib/oneclick-network-config.ts');
const { getOneClickSnapshot } = require('../lib/q4-oneclick-agent.ts');
const device = { mac:'02:aa:bb:cc:dd:10',ip:'192.168.50.36',name:'Synthetic phone' };
const network = () => ({
 version:1,lanCidr:'192.168.50.0/24',gatewayIp:'192.168.50.9',routerIp:'192.168.50.1',
 reservedIps:['192.168.50.1','192.168.50.9','192.168.50.20'],wifiInterfaceAlias:'SSID7',
});
const owned = () => ({
 _InstID:'IGD.LD1.DHCPBIND1',Name:'RPH-ccdd10',MACAddr:device.mac,
 IPAddr:device.ip,IPRouters:network().gatewayIp,
});
const transaction = async () => createZteBindingTransaction(await readOneClickNetworkConfig());
function xml(rows) {
 return '<ajax_response_xml_root><OBJ_DHCPBIND_ID>'+rows.map(row=>'<Instance>'+Object.entries(row)
  .map(([key,value])=>'<ParaName>'+key+'</ParaName><ParaValue>'+value+'</ParaValue>').join('')+'</Instance>')
  .join('')+'</OBJ_DHCPBIND_ID><IF_ERRORSTR>SUCC</IF_ERRORSTR></ajax_response_xml_root>';
}

async function fixture(initialRows, run, withConfig=true) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rph-binding-test-'));
 const configFile=path.join(directory,'.rph-oneclick-network.json');
 const oldData=process.env.DATA_DIR;
 const previousSerialize=admin.serializeZteSession,previousLogin=admin.withZteLogin;
 const state={rows:initialRows.map(row=>({...row})),forms:[],requests:0,logins:0,failApplyReply:false};
 process.env.DATA_DIR=directory;
 if(withConfig)fs.writeFileSync(configFile,JSON.stringify(network()),{mode:0o600});
 admin.serializeZteSession=work=>work();
 admin.withZteLogin=async operate=>{
  state.logins++;
  return operate(async (kind,tag,params,form)=>{
   state.requests++;
   assert.equal(kind,'vueData');
   assert.equal(tag,'static_bindAddr_data');
   if(!form)return xml(state.rows);
   state.forms.push({...form});
   if(form.IF_ACTION==='Apply') {
    state.rows.push({...form,_InstID:'IGD.LD1.DHCPBIND42'});
    if(state.failApplyReply) {
     state.failApplyReply=false;
     throw new Error('synthetic reply lost after router write');
    }
   } else if(form.IF_ACTION==='Delete') {
    const index=state.rows.findIndex(row=>row._InstID===form._InstID);
    assert.notEqual(index,-1);
    state.rows.splice(index,1);
   } else {
    assert.fail('unexpected router action');
   }
   return '<IF_ERRORSTR>SUCC</IF_ERRORSTR>';
  });
 };
 try { await run(state,configFile); }
 finally {
  admin.serializeZteSession=previousSerialize;admin.withZteLogin=previousLogin;
  if(oldData===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=oldData;
  fs.rmSync(directory,{recursive:true,force:true});
 }
}

test('gateway comes from private config; exact rollback preserves unrelated reservations',async()=>{
 const unrelated={...owned(),_InstID:'IGD.LD1.DHCPBIND8',Name:'Existing synthetic device',
  MACAddr:'02:aa:bb:cc:dd:11',IPAddr:'192.168.50.37',IPRouters:'192.168.50.1'};
 await fixture([unrelated],async state=>{
  const binding=await transaction();
  await binding.bindRouterToQ4(device);
  assert.equal(state.forms.length,1);
  assert.equal(state.forms[0].IF_ACTION,'Apply');
  assert.equal(state.forms[0].IPRouters,'192.168.50.9');
  assert.equal(state.forms[0].MACAddr,device.mac);
  assert.equal(state.forms[0].IPAddr,device.ip);
  await binding.restoreRouter(device);
  assert.equal(state.forms[1].IF_ACTION,'Delete');
  assert.equal(state.forms[1]._InstID,'IGD.LD1.DHCPBIND42');
  assert.deepEqual(state.rows,[unrelated]);
 });
});

test('reserved addresses reject before any router login or request',async()=>{
 await fixture([],async state=>{
  const binding=await transaction();
  for(const ip of network().reservedIps)await assert.rejects(binding.bindRouterToQ4({...device,ip}),/受控许可范围/);
  assert.equal(state.logins,0);assert.equal(state.requests,0);
 });
});

test('missing private config prevents creating a binding transaction or contacting the router',async()=>{
 await fixture([],async state=>{
  await assert.rejects(transaction(),/自动接入配置不可用/);
  assert.equal(state.logins,0);assert.equal(state.requests,0);
 },false);
});

test('conflicting pre-existing reservation is never overwritten or removed',async()=>{
 const existing={...owned(),Name:'Owner reservation',IPRouters:'192.168.50.1'};
 await fixture([existing],async state=>{
  const binding=await transaction();
  await assert.rejects(binding.bindRouterToQ4(device),/已有其他 MAC\/IP 绑定/);
  await binding.restoreRouter(device);
  assert.deepEqual(state.forms,[]);
  assert.deepEqual(state.rows,[existing]);
 });
});

test('retry followed by rollback preserves a pre-existing exact RPH reservation',async()=>{
 const existing=owned();
 await fixture([existing],async state=>{
  const binding=await transaction();
  await binding.bindRouterToQ4(device);
  await binding.restoreRouter(device);
  assert.deepEqual(state.forms,[],'an idempotent retry does not own an earlier reservation');
  assert.deepEqual(state.rows,[existing]);
  assert.equal(state.logins,1);
 });
});

test('uncertain POST response still permits ownership-checked rollback of this attempt',async()=>{
 await fixture([],async state=>{
  const binding=await transaction();
  state.failApplyReply=true;
  await assert.rejects(binding.bindRouterToQ4(device),/synthetic reply lost/);
  assert.equal(state.rows.length,1);
  await binding.restoreRouter(device);
  assert.deepEqual(state.forms.map(form=>form.IF_ACTION),['Apply','Delete']);
  assert.deepEqual(state.rows,[]);
 });
});

test('one transaction pins the validated configuration through bind and rollback',async()=>{
 await fixture([],async (state,file)=>{
  const config=await readOneClickNetworkConfig();
  const binding=createZteBindingTransaction(config);
  config.gatewayIp='192.168.50.10';
  config.reservedIps.push(device.ip);
  fs.unlinkSync(file);
  await binding.bindRouterToQ4(device);
  await binding.restoreRouter(device);
  assert.deepEqual(state.forms.map(form=>form.IPRouters),['192.168.50.9','192.168.50.9']);
  assert.deepEqual(state.rows,[]);
 });
});

test('a transaction cannot use its rollback authority on a second identity',async()=>{
 await fixture([],async state=>{
  const binding=await transaction();
  await binding.bindRouterToQ4(device);
  await assert.rejects(binding.restoreRouter({...device,mac:'02:aa:bb:cc:dd:11',ip:'192.168.50.37'}),/另一台设备/);
  assert.equal(state.forms.length,1);
  await binding.restoreRouter(device);
  assert.deepEqual(state.rows,[]);
 });
});

test('host unavailability is distinct from an available empty list; invalid states fail closed',async()=>{
 const net=require('node:net');
 const {EventEmitter}=require('node:events');
 const oldCreate=net.createConnection,oldEnabled=process.env.RPH_ONECLICK_ENABLED;
 let payload=new Error('synthetic unavailable');
 let connections=0;
 net.createConnection=()=>{
  connections++;
  const socket=new EventEmitter();
  socket.setTimeout=()=>socket;socket.destroy=()=>{};
  socket.write=raw=>{
   assert.equal(JSON.parse(raw).op,'status');
   queueMicrotask(()=>payload instanceof Error ? socket.emit('error',payload) :
    socket.emit('data',Buffer.from(JSON.stringify(payload)+'\n')));
  };
  queueMicrotask(()=>socket.emit('connect'));
  return socket;
 };
 process.env.RPH_ONECLICK_ENABLED='1';
 try {
  assert.equal((await getOneClickSnapshot()).available,false);
  payload={ok:true,states:[]};
  const noProof=await getOneClickSnapshot();
  assert.equal(noProof.available,true);
  assert.deepEqual(noProof.states,[]);
  assert.equal(noProof.strict.available,false,'legacy host has no strict attestation');
  payload={ok:true,states:[],strict:{available:true,reason:null}};
  const attested=await getOneClickSnapshot();
  assert.equal(attested.strict.available,true,'only an explicit host attestation enables strict');
  payload={ok:true,states:[],strict:{available:'true',reason:null}};
  const invalidProof=await getOneClickSnapshot();
  assert.equal(invalidProof.available,true,'a bad LA claim cannot disable SG status');
  assert.equal(invalidProof.strict.available,false,'invalid host proof fails closed for LA');
  const valid={managedMac:device.mac,managedIp:device.ip,activePlan:'flex',status:'active',
   appliedRevision:null,appliedAt:null,reason:null,phase:'active'};
  payload={ok:true,states:[{...valid,unexpected:'not returned'}]};
  assert.deepEqual((await getOneClickSnapshot()).states,[valid]);
  payload={ok:true,states:[valid,{...valid,managedMac:'invalid'}]};
  const invalid=await getOneClickSnapshot();
  assert.equal(invalid.available,false);assert.deepEqual(invalid.states,[]);
  delete process.env.RPH_ONECLICK_ENABLED;
  const before=connections;
  assert.equal((await getOneClickSnapshot()).available,false);
  assert.equal(connections,before);
 } finally {
  net.createConnection=oldCreate;
  if(oldEnabled===undefined)delete process.env.RPH_ONECLICK_ENABLED;else process.env.RPH_ONECLICK_ENABLED=oldEnabled;
 }
});
