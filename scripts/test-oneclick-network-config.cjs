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
const { readOneClickNetworkConfig, isAllowedOneClickIp } = require('../lib/oneclick-network-config.ts');
const valid = () => ({
  version:1, lanCidr:'192.168.50.0/24', gatewayIp:'192.168.50.7', routerIp:'192.168.50.1',
  reservedIps:['192.168.50.1','192.168.50.7','192.168.50.20'], wifiInterfaceAlias:'SSID7',
});
const message = '新设备自动接入配置不可用，请联系管理员检查';

async function fixture(run) {
  const old = process.env.DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'rph-private-network-test-'));
  const file = path.join(directory,'.rph-oneclick-network.json');
  process.env.DATA_DIR = directory;
  try { await run({directory,file}); }
  finally {
    if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
const rejectsPrivate = () => assert.rejects(readOneClickNetworkConfig(), error => {
  assert.equal(error.message,message);
  assert.equal(error.cause,undefined);
  return true;
});

test('reads a validated private configuration without rewriting its contents',async()=>{
 await fixture(async ({file})=>{
  const raw = JSON.stringify(valid());
  fs.writeFileSync(file,raw,{mode:0o600});
  assert.deepEqual(await readOneClickNetworkConfig(),valid());
  assert.equal(fs.readFileSync(file,'utf8'),raw);
  const boundary=raw+' '.repeat(16*1024-Buffer.byteLength(raw));
  fs.writeFileSync(file,boundary);
  assert.deepEqual(await readOneClickNetworkConfig(),valid());
 });
});

test('only unreserved hosts inside the configured private subnet can enroll',()=>{
 const config=valid();
 assert.equal(isAllowedOneClickIp('192.168.50.36',config),true);
 for (const ip of ['192.168.50.0','192.168.50.255','192.168.50.1','192.168.50.7',
  '192.168.50.20','192.168.51.36','203.0.113.36','192.168.50.999','::1','invalid']) {
  assert.equal(isAllowedOneClickIp(ip,config),false,ip);
 }
});

test('missing DATA_DIR or file, non-file, symlink and oversized data all fail closed',async()=>{
 const old=process.env.DATA_DIR;
 delete process.env.DATA_DIR;
 try { await rejectsPrivate(); }
 finally { if(old!==undefined)process.env.DATA_DIR=old; }
 await fixture(async ({directory,file})=>{
  await rejectsPrivate();
  fs.mkdirSync(file);
  await rejectsPrivate();
  fs.rmdirSync(file);
  const target=path.join(directory,'synthetic-target.json');
  fs.writeFileSync(target,JSON.stringify(valid()));
  fs.symlinkSync(target,file);
  await rejectsPrivate();
  fs.unlinkSync(file);
  fs.writeFileSync(file,' '.repeat(16*1024+1));
  await rejectsPrivate();
 });
});

test('invalid schema, subnet, gateway reservations and interface never disclose file details',async()=>{
 await fixture(async ({file})=>{
  const invalid=[null,[],{}, {...valid(),version:2}, {...valid(),lanCidr:'203.0.113.0/24'},
   {...valid(),lanCidr:'192.168.50.0/25'}, {...valid(),lanCidr:'192.168.50.2/24'},
   {...valid(),gatewayIp:'192.168.50.0'}, {...valid(),routerIp:'192.168.50.255'},
   {...valid(),routerIp:'192.168.51.1'}, {...valid(),reservedIps:[]},
   {...valid(),reservedIps:['192.168.50.1']}, {...valid(),reservedIps:['192.168.50.7']},
   {...valid(),reservedIps:['192.168.50.1','192.168.50.7','192.168.51.20']},
   {...valid(),reservedIps:['192.168.50.1','192.168.50.7','192.168.50.7']},
   {...valid(),reservedIps:Array.from({length:33},(_,i)=>`192.168.50.${i+1}`)},
   {...valid(),wifiInterfaceAlias:'SSID0'}, {...valid(),wifiInterfaceAlias:'SSID7\nextra'},
   {...valid(),unexpected:'synthetic-private-value'},
  ];
  for(const value of invalid) {
   fs.writeFileSync(file,JSON.stringify(value));
   await rejectsPrivate();
  }
  fs.writeFileSync(file,'{"synthetic-private-value":');
  await rejectsPrivate();
 });
});
