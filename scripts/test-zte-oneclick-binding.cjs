const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(
  ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022},
  }).outputText,filename,
);
const {parseZteBindings}=require('../lib/zte-oneclick-binding.ts');
function xml(rows){
 return '<ajax_response_xml_root><OBJ_DHCPBIND_ID>'+rows.map(row=>
  '<Instance>'+Object.entries(row).map(([key,value])=>
    '<ParaName>'+key+'</ParaName><ParaValue>'+value+'</ParaValue>').join('')+'</Instance>'
 ).join('')+'</OBJ_DHCPBIND_ID><IF_ERRORSTR>SUCC</IF_ERRORSTR></ajax_response_xml_root>';
}
test('real ZTE static-bind payload parser matches exact MAC, IP, custom gateway, _InstID',()=>{
 const rows=parseZteBindings(xml([{
  _InstID:'IGD.LD1.DHCPBIND1',Name:'RPH-AABBCCDD',
  MACAddr:'02:AA:BB:CC:DD:10',IPAddr:'192.168.50.36',
  IPRouters:'192.168.50.7',
 }]));
 assert.deepEqual(rows,[{
  instance:'IGD.LD1.DHCPBIND1',name:'RPH-AABBCCDD',
  mac:'02:aa:bb:cc:dd:10',ip:'192.168.50.36',
  gateway:'192.168.50.7',
 }]);
});
test('router SessionTimeout, HTML or malformed reservation rows always fail closed',()=>{
 assert.throws(()=>parseZteBindings('<html><IF_ERRORSTR>SessionTimeout</IF_ERRORSTR></html>'));
 assert.throws(()=>parseZteBindings(xml([{Name:'Missing-MAC',IPAddr:'192.168.50.36'}])));
 assert.throws(()=>parseZteBindings('{"success":true}'));
 assert.deepEqual(parseZteBindings('<OBJ_DHCPBIND_ID />'),[]);
});
