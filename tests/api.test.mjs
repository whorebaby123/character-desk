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
 assert.throws(()=>apiBase({...native,baseURL:'https://127.0.0.1/v1'}));
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
