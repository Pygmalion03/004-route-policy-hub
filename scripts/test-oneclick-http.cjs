// Full HTTP smoke test on localhost, with fake credentials and NO router access.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const path=require('node:path');

async function main(){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'rph-oneclick-http-'));
 const temp=net.createServer();
 temp.listen(0,'127.0.0.1');
 await once(temp,'listening');
 const port=temp.address().port;
 await new Promise(resolve=>temp.close(resolve));
 const url='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,
   [path.join(__dirname,'../node_modules/next/dist/bin/next'),
    'start','--hostname','127.0.0.1','--port',String(port)],
   {cwd:path.join(__dirname,'..'),env:{
    ...process.env,DATA_DIR:data,ADMIN_PASSWORD:'synthetic-local-secret',
    ZTE_ROUTER_URL:'',ZTE_ROUTER_PASSWORD:'',RPH_ONECLICK_ENABLED:'0',
    LAN_MANAGEMENT_HOST:'127.0.0.1:'+port,PUBLIC_BASE_URL:url,
   },stdio:['ignore','pipe','pipe']}
 );
 let output='';
 proc.stderr.on('data',x=>{output+=x.toString()});
 proc.stdout.on('data',x=>{output+=x.toString()});
 try{
  let ready=false;
  for(let i=0;i<70;i++){
   if(proc.exitCode!==null)break;
   try{if((await fetch(url+'/home-network')).ok){ready=true;break}}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'fixture Next did not become healthy: '+output.slice(0,500));
  const rendered=await (await fetch(url+'/home-network')).text();
  assert.ok(rendered.includes('新设备默认家庭宽带直连'),
    'Server-rendered page missing the one-click default-direct text');
  const endpoint=url+'/api/home-network/devices/switch';
  assert.equal((await fetch(endpoint)).status,401);
  assert.equal((await fetch(endpoint,{headers:{'x-admin-password':'synthetic-local-secret'}})).status,503);
  const payload={mac:'02:11:22:33:44:55',plan:'flex'};
  const call=(body,secret='synthetic-local-secret')=>fetch(endpoint,{
   method:'POST',headers:{'content-type':'application/json','x-admin-password':secret},
   body:JSON.stringify(body),
  });
  assert.equal((await call(payload,'')).status,401);
  assert.equal((await call(payload,'invalid')).status,401);
  assert.equal((await call({...payload,plan:'unknown'})).status,400);
  assert.equal((await call({...payload,plan:'strict'})).status,409);
  const reply=await call(payload);
  assert.equal(reply.status,503);
  const j=await reply.json();
  assert.ok(j.error);
  assert.equal(fs.existsSync(path.join(data,'device-assignments.json')),false);
  assert.equal(fs.existsSync(path.join(data,'direct-onboarding-requests.json')),false);
  assert.equal((await fetch(url+'/rules/direct.yaml')).status,200);
  assert.equal((await fetch(url+'/rules/proxy.yaml')).status,200);
  console.log('PASS oneclick HTTP: auth + invalid payload + unavailable gateway fail-closed; no route config written');
 }finally{
  proc.kill('SIGTERM');
  fs.rmSync(data,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
