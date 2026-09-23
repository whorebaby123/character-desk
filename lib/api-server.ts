import { apiBase, authHeaders, credentialFrom, generationRequest, record, restoreApiConfig, type ApiConfig } from './api-config.ts';
export class ApiFailure extends Error {
  status:number; code:string; stage:string;
  constructor(message:string,status=400,code='INVALID_CONFIGURATION',stage='configuration'){super(message);this.status=status;this.code=code;this.stage=stage;}
}
export async function readApiRequest(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiFailure('请求来源无效。',403,'INVALID_ORIGIN','request');
  const reader=request.body?.getReader();if(!reader)throw new ApiFailure('请求正文为空。');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>600000){await reader.cancel();throw new ApiFailure('请求过大，请减少设定或对话范围。',413,'REQUEST_TOO_LARGE','request');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let body:Record<string,unknown>;try{body=record(JSON.parse(new TextDecoder().decode(bytes)));}catch{throw new ApiFailure('请求正文不是有效 JSON。',400,'INVALID_JSON','request');}
  const config=restoreApiConfig(body),key=credentialFrom(body,request.headers);apiBase(config);
  return {body,config,key};
}
function redact(text:string,key:string):string{
  return text.split(key).join('[密钥已隐藏]').replace(/(?:Bearer\s+)[^\s"'<>]+/gi,'Bearer [密钥已隐藏]').replace(/(?:AIza|AQ\.)[A-Za-z0-9_.-]+/g,'[密钥已隐藏]').replace(/sk-[A-Za-z0-9_-]+/g,'[密钥已隐藏]').slice(0,900);
}
async function jsonBody(response:Response,key:string):Promise<Record<string,unknown>>{
  const reader=response.body?.getReader();if(!reader)throw new ApiFailure('服务商返回了空响应。',502,'EMPTY_RESPONSE','provider');
  let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new ApiFailure('服务商响应过大，请减少输出长度。',502,'RESPONSE_TOO_LARGE','provider');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let data:Record<string,unknown>={};try{data=record(JSON.parse(new TextDecoder().decode(bytes)));}catch{if(response.ok)throw new ApiFailure('服务商返回的不是 JSON，请检查接口地址是否指向 API。',502,'NON_JSON_RESPONSE','provider');}
  if(!response.ok){const upstream=record(data.error);const message=typeof upstream.message==='string'?redact(upstream.message,key):'';const hints:Record<number,string>={400:'服务商拒绝了请求参数，请检查模型、思考强度及采样参数。',401:'服务商认证失败，请检查密钥和认证方式。',403:'服务商拒绝访问，请检查密钥权限、地区和模型权限。',404:'找不到模型或接口路径。',429:'服务商限流或配额不足。'};
    throw new ApiFailure(`${hints[response.status]||'服务商请求失败。'}（上游 HTTP ${response.status}）${message?' '+message:''}`,502,`UPSTREAM_${response.status}`,'provider');}
  return data;
}
export async function providerJson(url:URL,key:string,options:RequestInit,requestSignal:AbortSignal):Promise<Record<string,unknown>>{
  // Portable across Worker runtimes: do not depend on AbortSignal.any/timeout.
  const controller=new AbortController();let timeout=false;
  const cancel=()=>controller.abort();if(requestSignal.aborted)cancel();else requestSignal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timeout=true;controller.abort();},90000);
  try{
    // Workers supports follow/manual, but rejects redirect:'error' before any I/O.
    // Inspect the response ourselves so credentials never follow a redirect.
    const response=await fetch(url,{...options,redirect:'manual',signal:controller.signal});
    if(response.status>=300&&response.status<400){
      await response.body?.cancel();
      throw new ApiFailure('API 地址返回了重定向。为避免将密钥转发到其他地址，已停止请求；请填写服务商最终的 API 地址。',502,'UPSTREAM_REDIRECT','provider');
    }
    return await jsonBody(response,key);
  }
  catch(error){if(error instanceof ApiFailure)throw error;if(timeout)throw new ApiFailure('请求超过 90 秒，请降低思考强度或分模块生成。',504,'TIMEOUT','network');if(controller.signal.aborted)throw new ApiFailure('请求已停止。',499,'CANCELLED','network');throw new ApiFailure('无法连接服务商。请检查 API 地址、认证方式或服务商网络可达性。',502,'NETWORK_ERROR','network');}
  finally{clearTimeout(timer);requestSignal.removeEventListener('abort',cancel);}
}
export async function generate(config:ApiConfig,key:string,prompt:string,signal:AbortSignal){
  const prepared=generationRequest(config,key,prompt);const data=await providerJson(prepared.url,key,{method:'POST',headers:prepared.headers,body:JSON.stringify(prepared.body)},signal);
  let text='';let finish='';
  if(config.provider==='gemini'){
    const candidate=record(Array.isArray(data.candidates)?data.candidates[0]:undefined);finish=String(candidate.finishReason||'');
    const content=record(candidate.content);text=(Array.isArray(content.parts)?content.parts:[]).map(record).filter(p=>p.thought!==true&&typeof p.text==='string').map(p=>p.text).join('');
    if(record(data.promptFeedback).blockReason)throw new ApiFailure('服务商未接受这次内容请求。',422,'PROVIDER_BLOCKED','provider');
  }else{const choice=record(Array.isArray(data.choices)?data.choices[0]:undefined);finish=String(choice.finish_reason||'');const content=record(choice.message).content;text=typeof content==='string'?content:Array.isArray(content)?content.map(record).filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text).join(''):'';}
  if(finish==='length'||finish==='MAX_TOKENS')throw new ApiFailure('输出达到长度上限，请增加最大输出、降低思考强度或分模块生成。',422,'OUTPUT_TRUNCATED','provider');
  if(!text.trim())throw new ApiFailure('服务商没有返回正文。可能仅有思考内容、模型格式不兼容或输出被阻止。',422,'EMPTY_CONTENT','provider');
  return {text,notes:prepared.notes};
}
export async function listModels(config:ApiConfig,key:string,signal:AbortSignal){
  const base=apiBase(config);base.pathname+='/models';let pageToken='';const models:{id:string;label:string;topK?:number}[]=[];
  for(let page=0;page<10;page++){
    const url=new URL(base);if(pageToken)url.searchParams.set('pageToken',pageToken);
    const data=await providerJson(url,key,{method:'GET',headers:authHeaders(config,key)},signal);
    const rows=config.provider==='gemini'?data.models:data.data;
    if(!Array.isArray(rows))throw new ApiFailure('模型列表格式不兼容，可手动填写模型名称。',502,'INVALID_MODEL_LIST','provider');
    for(const item of rows){const m=record(item);if(config.provider==='gemini'&&Array.isArray(m.supportedGenerationMethods)&&!m.supportedGenerationMethods.includes('generateContent'))continue;
      const id=typeof m.id==='string'?m.id:typeof m.name==='string'?m.name.replace(/^models\//,''):'';
      if(id)models.push({id,label:typeof m.displayName==='string'?m.displayName:id,...(typeof m.topK==='number'?{topK:m.topK}:{})});}
    pageToken=config.provider==='gemini'&&typeof data.nextPageToken==='string'?data.nextPageToken:'';if(!pageToken)break;
  }
  return {models:[...new Map(models.map(m=>[m.id,m])).values()],partial:!!pageToken};
}
export function apiError(error:unknown){
  const e=error instanceof ApiFailure?error:new ApiFailure(error instanceof Error?error.message:'配置无效。');
  return Response.json({error:e.message,code:e.code,stage:e.stage},{status:e.status,headers:{'Cache-Control':'no-store'}});
}
