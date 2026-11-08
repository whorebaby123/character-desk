import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultApiConfig,restoreApiConfig,normalizeKey,credentialFrom,apiBase,authHeaders,generationRequest,configForStorage,numericParameters} from '../lib/api-config.ts';
import {generate,listModels,readApiRequest,apiError} from '../lib/api-server.ts';
import {importPreset,CREATION_PRESETS} from '../lib/presets.ts';
import {blank,validateProject,convert,exportObject,makePrompt} from '../lib/project.ts';
const key='AQ.dummy-not-a-real-credential';
const native={...defaultApiConfig};
const compatible={...native,provider:'gemini-compatible',baseURL:'https://generativelanguage.googleapis.com/v1beta/openai'};
const signal=()=>new AbortController().signal;
test('Opaque credentials accept raw, quoted and full header values without a prefix whitelist',()=>{
 for(const value of [key,`Bearer ${key}`,`Authorization: Bearer ${key}`,`"Bearer ${key}"`,`Authorization: "Bearer ${key}"`,`x-goog-api-key: ${key}`])assert.equal(normalizeKey(value),key);
 for(const field of ['key','Key','apiKey','api_key','Authorization','authorization'])assert.equal(credentialFrom({[field]:key}),key);
 assert.equal(credentialFrom({},new Headers({authorization:`Bearer ${key}`})),key);
 for(const value of ['', 'two keys', 'bad\nheader', '中文'])assert.throws(()=>normalizeKey(value));
});
test('Automatic and manual auth keep native and compatible protocols distinct',()=>{
 assert.equal(authHeaders(native,key)['x-goog-api-key'],key);
 assert.equal(authHeaders(compatible,key).Authorization,`Bearer ${key}`);
 assert.equal(authHeaders({...compatible,authMode:'authorization'},key).Authorization,key);
 assert.equal(authHeaders({...compatible,authMode:'key'},key).key,key);
 assert.equal(apiBase({...native,baseURL:compatible.baseURL+'/chat/completions'}).pathname,'/v1beta');
 assert.equal(apiBase({...compatible,baseURL:native.baseURL}).pathname,'/v1beta/openai');
 assert.throws(()=>apiBase({...native,baseURL:'https://127.0.0.1/v1'}),/内网或本机/);
});
test('Plain http IP proxies keep the port and a single /v1 on model and chat requests',async()=>{
 const custom={...defaultApiConfig,provider:'custom',model:'proxy-model',authMode:'auto'};
 const forms=['http://1.2.3.4','http://1.2.3.4/','http://1.2.3.4/v1','http://1.2.3.4/v1/'];
 for(const baseURL of forms){
  assert.equal(apiBase({...custom,baseURL}).href,'http://1.2.3.4/v1');
  assert.equal(String(generationRequest({...custom,baseURL},key,'hi').url),'http://1.2.3.4/v1/chat/completions');
 }
 assert.equal(apiBase({...custom,baseURL:'http://1.2.3.4:8080/v1/chat/completions'}).href,'http://1.2.3.4:8080/v1');
 assert.equal(apiBase({...custom,baseURL:'http://1.2.3.4:8080/v1/models'}).pathname,'/v1');
 assert.equal(String(generationRequest({...custom,baseURL:'https://8.8.8.8:8443'},key,'hi').url),'https://8.8.8.8:8443/v1/chat/completions');
 const seen=[];
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,opts)=>{seen.push({url:String(url),method:opts.method,redirect:opts.redirect,auth:opts.headers.Authorization});
   if(String(url).endsWith('/models'))return Response.json({data:[{id:'proxy-model'}]});
   assert.equal(JSON.parse(opts.body).model,'proxy-model');
   return Response.json({choices:[{finish_reason:'stop',message:{content:'OK'}}]});};
  const config={...custom,baseURL:'http://1.2.3.4:8080/v1'};
  assert.deepEqual((await listModels(config,key,signal())).models.map(m=>m.id),['proxy-model']);
  assert.equal((await generate(config,key,'hi',signal())).text,'OK');
  assert.deepEqual(seen.map(item=>item.url),['http://1.2.3.4:8080/v1/models','http://1.2.3.4:8080/v1/chat/completions']);
  assert.equal(seen[0].method,'GET');assert.equal(seen[1].method,'POST');
  assert.equal(seen[1].auth,`Bearer ${key}`);assert.equal(seen[1].redirect,'manual');
  const bare={...custom,baseURL:'http://1.2.3.4'};
  await listModels(bare,key,signal());await generate(bare,key,'hi',signal());
  assert.deepEqual(seen.slice(2).map(item=>item.url),['http://1.2.3.4/v1/models','http://1.2.3.4/v1/chat/completions']);
 }finally{globalThis.fetch=original;}
});
test('Private, metadata, credential and query targets stay blocked unless the operator flag is set',()=>{
 const custom={...defaultApiConfig,provider:'custom',model:'m'};
 const blocked=['http://127.0.0.1/v1','http://127.0.0.1:11434/v1','http://10.0.0.1/v1','http://192.168.1.1:8080/v1','http://172.16.0.1/v1','http://[::1]/v1','http://[fd00::1]/v1','http://localhost/v1','http://router.local/v1','http://2130706433/','http://0x7f000001/','http://0177.0.0.1/','http://127.1/','http://[::ffff:127.0.0.1]/v1','http://[::7f00:1]/','http://[64:ff9b::7f00:1]/','http://[2002:7f00:1::]/'];
 for(const baseURL of blocked)assert.throws(()=>apiBase({...custom,baseURL}),/内网或本机/);
 for(const baseURL of ['http://169.254.169.254/latest/meta-data','http://169.254.1.1/','http://[::ffff:169.254.169.254]/','http://0.0.0.0/','http://100.64.0.1/','http://255.255.255.255/','http://224.0.0.1/','http://192.0.2.1/','http://[fe80::1]/','http://metadata.google.internal/','http://example.invalid/','http://1.2.3.4:0/'])assert.throws(()=>apiBase({...custom,baseURL}));
 assert.throws(()=>apiBase({...custom,baseURL:'http://user:pass@1.2.3.4/v1'}),/账号/);
 assert.throws(()=>apiBase({...custom,baseURL:'http://1.2.3.4/v1?token=1'}),/查询参数/);
 assert.throws(()=>apiBase({...custom,baseURL:'http://1.2.3.4/v1#frag'}),/查询参数/);
 assert.throws(()=>apiBase({...custom,baseURL:'ftp://1.2.3.4/v1'}),/http 或 https/);
 assert.equal(apiBase({...custom,baseURL:'http://[::ffff:1.2.3.4]:8080/v1'}).href,'http://1.2.3.4:8080/v1');
 assert.equal(apiBase({...custom,baseURL:'https://[2606:4700:4700::1111]:8443/v1'}).port,'8443');
 assert.equal(apiBase({...custom,baseURL:'http://172.15.255.255/v1'}).hostname,'172.15.255.255');
 assert.equal(apiBase({...custom,baseURL:'http://172.32.0.1:9000'}).href,'http://172.32.0.1:9000/v1');
 const previous=process.env.ALLOW_PRIVATE_API_HOSTS;
 process.env.ALLOW_PRIVATE_API_HOSTS='1';
 try{
  assert.equal(apiBase({...custom,baseURL:'http://127.0.0.1:11434/v1'}).href,'http://127.0.0.1:11434/v1');
  assert.equal(apiBase({...custom,baseURL:'http://192.168.1.8:8080'}).href,'http://192.168.1.8:8080/v1');
  assert.equal(apiBase({...custom,baseURL:'http://[::1]:8080/v1'}).hostname,'[::1]');
  assert.equal(String(generationRequest({...custom,baseURL:'http://10.1.2.3'},key,'hi').url),'http://10.1.2.3/v1/chat/completions');
  assert.throws(()=>apiBase({...custom,baseURL:'http://169.254.169.254/'}),/不能作为 API 地址/);
  assert.throws(()=>apiBase({...custom,baseURL:'http://[fe80::1]/'}),/不能作为 API 地址/);
  assert.throws(()=>apiBase({...custom,baseURL:'http://user:pass@127.0.0.1/v1'}),/账号/);
 }finally{if(previous===undefined)delete process.env.ALLOW_PRIVATE_API_HOSTS;else process.env.ALLOW_PRIVATE_API_HOSTS=previous;}
});
test('Restored configuration migrates legacy fields and remembers credentials only when enabled',()=>{
 assert.equal(restoreApiConfig({baseURL:compatible.baseURL,model:'old-model'}).provider,'gemini-compatible');
 assert.equal(restoreApiConfig({temperature:0}).temperature,'0');
 assert.equal(configForStorage(native,key).key,key);
 assert.ok(!('key' in configForStorage({...native,rememberKey:false},key)));
 assert.throws(()=>numericParameters(restoreApiConfig({maxTokens:0})));
 assert.throws(()=>generationRequest(restoreApiConfig({model:''}),key,'OK'));
});
test('Native request preserves zero temperature and maps thinking and sampling',()=>{
 const r=generationRequest({...native,temperature:'0',topP:'.9',topK:'40',reasoning:'high'},key,'OK');
 assert.equal(String(r.url),native.baseURL+'/models/'+native.model+':generateContent');
 assert.deepEqual(r.body.generationConfig,{maxOutputTokens:8192,temperature:0,topP:.9,topK:40,thinkingConfig:{thinkingLevel:'HIGH'}});
 assert.ok(!('temperature' in generationRequest(native,key,'OK').body.generationConfig));
 assert.deepEqual(generationRequest({...native,model:'gemini-2.5-flash',reasoning:'none'},key,'OK').body.generationConfig.thinkingConfig,{thinkingBudget:0});
 assert.throws(()=>generationRequest({...compatible,topK:'40'},key,'OK'),/不支持 top K/);
 for(const change of [{temperature:'3'},{topP:'NaN'},{topK:'1.5'},{maxTokens:1}])assert.throws(()=>generationRequest({...native,...change},key,'OK'));
});
test('DeepSeek thinking omits ineffective sampling parameters and explains the omission',()=>{
 const c={...native,provider:'deepseek',model:'deepseek-v4-flash',baseURL:'https://api.deepseek.com/v1',temperature:'.7',topP:'.8',reasoning:'max'};
 const r=generationRequest(c,key,'OK');assert.deepEqual(r.body.thinking,{type:'enabled'});assert.equal(r.body.reasoning_effort,'max');assert.ok(!('temperature' in r.body));assert.equal(r.notes.length,1);
 const off=generationRequest({...c,reasoning:'none'},key,'OK');assert.equal(off.body.temperature,.7);assert.equal(off.body.top_p,.8);assert.ok(!('reasoning_effort' in off.body));
});
test('Native generation works without AbortSignal.any and ignores thought-only parts',async()=>{
 const original=globalThis.fetch,any=AbortSignal.any;
 try{AbortSignal.any=undefined;globalThis.fetch=async(url,opts)=>{assert.equal(opts.headers['x-goog-api-key'],key);assert.equal(opts.redirect,'manual');return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'private thought',thought:true},{text:'OK'}]}}]});};
 assert.equal((await generate(native,key,'OK',signal())).text,'OK');
 globalThis.fetch=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'thought',thought:true}]}}]});await assert.rejects(()=>generate(native,key,'OK',signal()),e=>e.code==='EMPTY_CONTENT');
 }finally{globalThis.fetch=original;AbortSignal.any=any;}
});
test('Upstream errors preserve diagnosis and redact opaque credentials',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({error:{message:'bad key '+key}},{status:400});
 await assert.rejects(()=>generate(native,key,'OK',signal()),e=>{assert.equal(e.code,'UPSTREAM_400');assert.ok(!e.message.includes(key));assert.match(e.message,/上游 HTTP 400/);return true;});
 globalThis.fetch=async()=>new Response('not json');await assert.rejects(()=>generate(native,key,'OK',signal()),e=>e.code==='NON_JSON_RESPONSE');
 globalThis.fetch=async()=>{throw Error('network '+key);};await assert.rejects(()=>generate(native,key,'OK',signal()),e=>e.code==='NETWORK_ERROR'&&!e.message.includes(key));
 }finally{globalThis.fetch=original;}
});
test('Native model list follows pagination and filters non-generation models',async()=>{
 const original=globalThis.fetch;let n=0;try{globalThis.fetch=async url=>{n++;if(n===1)return Response.json({models:[{name:'models/embedding',supportedGenerationMethods:['embedContent']},{name:'models/first',topK:40}],nextPageToken:'next'});assert.equal(url.searchParams.get('pageToken'),'next');return Response.json({models:[{name:'models/second'}]});};
 const result=await listModels(native,key,signal());assert.deepEqual(result.models.map(m=>m.id),['first','second']);assert.equal(result.partial,false);
 }finally{globalThis.fetch=original;}
});
test('Redirect is inspected manually and blocked without forwarding credentials',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('redirect',{status:307,headers:{location:'https://other.example.com/collect'}});};
 await assert.rejects(()=>generate(native,key,'OK',signal()),e=>e.code==='UPSTREAM_REDIRECT'&&!e.message.includes(key));assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('Request parser accepts Authorization alias but rejects invalid origins and JSON',async()=>{
 const req=(body,origin='https://desk.example.com')=>new Request('https://desk.example.com/api/connection',{method:'POST',headers:{origin},body});
 assert.equal((await readApiRequest(req(JSON.stringify({...native,Authorization:`Bearer ${key}`})))).key,key);
 await assert.rejects(()=>readApiRequest(req('{}','https://other.example.com')),e=>e.code==='INVALID_ORIGIN');
 await assert.rejects(()=>readApiRequest(req('{bad')),e=>e.code==='INVALID_JSON');
 assert.equal(apiError(Error('invalid')).headers.get('cache-control'),'no-store');
});
test('Creative presets import, persist through backup and conversion, and stay outside card exports',()=>{
 const p=blank();p.creationPreset=importPreset('{"name":"风格","prompt":"语言简洁"}','preset.json');
 assert.equal(validateProject(JSON.parse(JSON.stringify(p))).creationPreset.text,'语言简洁');
 assert.equal(convert(p,'world').creationPreset.name,'风格');
 assert.ok(!('creationPreset' in exportObject(p)));
 assert.match(makePrompt(p,{mode:'generate',creationPreset:CREATION_PRESETS[0]}),/创作预设只用于风格/);
 assert.throws(()=>validateProject({...p,creationPreset:{text:23}}),/预设格式/);
 assert.throws(()=>importPreset('{"prompts":[]}','preset.json'),/预设内容/);
});
