const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename,
);
const { withZteLogin, serializeZteSession } = require('../lib/zte-router-admin.ts');

const prior = Object.fromEntries(
  ['ZTE_ROUTER_URL', 'ZTE_ROUTER_PASSWORD', 'ZTE_ROUTER_USERNAME', 'ZTE_ROUTER_CREDENTIALS_FILE']
    .map(k => [k,process.env[k]]));
const originalFetch=global.fetch;
function setup(){
 process.env.ZTE_ROUTER_URL='http://192.168.50.1/';
 process.env.ZTE_ROUTER_PASSWORD='fixture-password-not-real';
 process.env.ZTE_ROUTER_USERNAME='admin';
 delete process.env.ZTE_ROUTER_CREDENTIALS_FILE;
}
function reset(){
 global.fetch=originalFetch;
 for(const [k,v] of Object.entries(prior)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
}
function response(value, headers={}){
 return new Response(typeof value==='string'?value:JSON.stringify(value), {
  status:200,headers,
 });
}

test('ZTE login token is injected into exact static binding POST, then renewed via x_xsrf_token',async()=>{
 setup();
 const seen=[];
 global.fetch=async(url,options)=>{
  const u=new URL(url);
  const method=options.method||'GET';
  const body=method==='POST'?Object.fromEntries(new URLSearchParams(options.body)):{};
  const tag=u.searchParams.get('_tag');
  seen.push({tag,method,body,hasCookie:!!options.headers.cookie});
  if(tag==='login_entry' && method==='GET')
    return response('bootstrap',{ 'set-cookie':'SID=bootstrap; Path=/'});
  if(tag==='login_token_json')
    return response({logintoken:'challenge-123',_sessionToken:'challenge-session'});
  if(tag==='login_entry' && method==='POST') {
    assert.equal(body._sessionTOKEN,'challenge-session');
    assert.equal(body.Username,'admin');
    assert.match(body.Password,/^[a-f0-9]{64}$/);
    return response({login_need_refresh:true,sess_token:'acceptedSessionToken123'},
      {'set-cookie':'SID=auth; Path=/'});
  }
  if(tag==='static_bindAddr_data' && method==='GET')
    return response('<OBJ_DHCPBIND_ID/>',{'x_xsrf_token':'rotatedSessionToken456'});
  if(tag==='static_bindAddr_data' && method==='POST') {
    assert.equal(body._sessionTOKEN,'rotatedSessionToken456');
    assert.equal(body.IF_ACTION,'Apply');
    assert.equal(body.IPRouters,'192.168.50.7');
    assert.equal(body.MACAddr,'02:aa:bb:cc:dd:10');
    assert.equal(options.headers.cookie,'SID=auth');
    return response('<IF_ERRORSTR>SUCC</IF_ERRORSTR>');
  }
  if(tag==='logout_entry'){
    assert.equal(body._sessionTOKEN,'acceptedSessionToken123');
    return response({ok:true});
  }
  throw Error('unexpected mock endpoint '+tag);
 };
 try {
  await serializeZteSession(()=>withZteLogin(async req=>{
    await req('vueData','static_bindAddr_data',{_:'1'});
    await req('vueData','static_bindAddr_data',{},{
      IF_ACTION:'Apply',_InstID:'-1',Name:'RPH-AABBCCDD',
      MACAddr:'02:aa:bb:cc:dd:10',IPAddr:'192.168.50.36',IPRouters:'192.168.50.7',
    });
  }));
  assert.deepEqual(seen.map(x=>[x.tag,x.method]),[
    ['login_entry','GET'],['login_token_json','GET'],['login_entry','POST'],
    ['static_bindAddr_data','GET'],['static_bindAddr_data','POST'],['logout_entry','POST'],
  ]);
 } finally {reset()}
});

test('ZTE refused/missing session token must prevent any router binding POST',async()=>{
 setup();
 const tags=[];
 global.fetch=async(url,options)=>{
  const u=new URL(url),tag=u.searchParams.get('_tag');
  tags.push(tag);
  if(tag==='login_token_json')return response({logintoken:'abcd',_sessionToken:'prelogin'});
  if(tag==='login_entry' && options.method==='POST')
    return response({login_need_refresh:true});
  return response('init',{ 'set-cookie':'SID=x; Path=/' });
 };
 try{
  await assert.rejects(withZteLogin(async req=>{
    await req('vueData','static_bindAddr_data',{},{
      IF_ACTION:'Apply',IPRouters:'192.168.50.7'
    });
  }),/没有返回有效会话令牌/);
  assert.equal(tags.includes('static_bindAddr_data'),false);
 }finally{reset()}
});
