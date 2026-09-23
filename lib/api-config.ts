export type Provider = 'gemini' | 'gemini-compatible' | 'deepseek' | 'custom';
export type AuthMode = 'auto' | 'bearer' | 'x-goog-api-key' | 'x-api-key' | 'key' | 'authorization';
export type ApiConfig = {
  provider: Provider; baseURL: string; model: string; authMode: AuthMode; maxTokens: number;
  reasoning: string; temperature: string; topP: string; topK: string; rememberKey: boolean;
};
export const PROVIDERS: {id:Provider;label:string;url:string;models:string[]}[] = [
  {id:'gemini',label:'Google AI Studio · Gemini 原生',url:'https://generativelanguage.googleapis.com/v1beta',models:['gemini-3.8-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite','gemini-2.5-flash']},
  {id:'gemini-compatible',label:'Google AI Studio · OpenAI 兼容',url:'https://generativelanguage.googleapis.com/v1beta/openai',models:['gemini-3.8-flash','gemini-3.1-pro-preview','gemini-3.1-flash-lite','gemini-2.5-flash']},
  {id:'deepseek',label:'DeepSeek',url:'https://api.deepseek.com/v1',models:['deepseek-v4-flash','deepseek-v4-pro']},
  {id:'custom',label:'自定义 · OpenAI 兼容',url:'',models:[]},
];
export const defaultApiConfig:ApiConfig={provider:'gemini',baseURL:PROVIDERS[0].url,model:PROVIDERS[0].models[0],authMode:'auto',maxTokens:8192,reasoning:'default',temperature:'',topP:'',topK:'',rememberKey:true};
export const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function detectProvider(url:string):Provider {
  try {const u=new URL(url);if(u.hostname==='generativelanguage.googleapis.com')return u.pathname.includes('/openai')?'gemini-compatible':'gemini';if(u.hostname==='api.deepseek.com')return 'deepseek';}catch{/* incomplete input is custom */}return 'custom';
}
export function restoreApiConfig(value:unknown):ApiConfig{
  const r=record(value),baseURL=typeof r.baseURL==='string'?r.baseURL:defaultApiConfig.baseURL;
  const provider=PROVIDERS.some(p=>p.id===r.provider)?r.provider as Provider:detectProvider(baseURL);
  return {...defaultApiConfig,provider,baseURL,model:typeof r.model==='string'?r.model:(PROVIDERS.find(p=>p.id===provider)?.models[0]||''),maxTokens:r.maxTokens===undefined?8192:Number(r.maxTokens),authMode:['auto','bearer','x-goog-api-key','x-api-key','key','authorization'].includes(String(r.authMode))?r.authMode as AuthMode:'auto',reasoning:typeof r.reasoning==='string'?r.reasoning:'default',temperature:typeof r.temperature==='string'||typeof r.temperature==='number'?String(r.temperature):'',topP:typeof r.topP==='string'||typeof r.topP==='number'?String(r.topP):'',topK:typeof r.topK==='string'||typeof r.topK==='number'?String(r.topK):'',rememberKey:r.rememberKey!==false};
}
export function normalizeKey(value:unknown):string{
  if(typeof value!=='string')throw Error('请填写 API 密钥。');
  let key=value.trim();
  // Users often paste a whole header. Prefixes are syntax; key contents are opaque.
  for(let i=0;i<3;i++){
    if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1).trim();
    key=key.replace(/^(?:authorization|x-goog-api-key|x-api-key|api[-_ ]?key|key)\s*[:=]\s*/i,'').replace(/^Bearer\s+/i,'').trim();
  }
  if(!key||key.length>4096||/[^\x21-\x7e]/.test(key))throw Error('密钥为空或包含空格、换行、非英文字符；可粘贴原始 Key 或单行 Authorization: Bearer 值。');
  return key;
}
export function credentialFrom(body:Record<string,unknown>,headers?:Headers):string{
  return normalizeKey(body.key||body.Key||body.apiKey||body.api_key||body.authorization||body.Authorization||headers?.get('authorization')||headers?.get('x-goog-api-key')||headers?.get('x-api-key'));
}
export function apiBase(config:ApiConfig):URL{
  let url:URL;try{url=new URL(config.baseURL.trim());}catch{throw Error('请输入有效的 API 地址。');}
  const h=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(url.port&&url.port!=='443'))throw Error('API 地址需为不含账号、查询参数的 HTTPS 地址（443 端口）。');
  if(!h.includes('.')||h.includes(':')||/^[\d.]+$/.test(h)||/(^|\.)(localhost|local|internal|test|invalid)$/.test(h))throw Error('请使用公网 API 域名。');
  url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/(chat\/completions|models)$/,'');
  if(config.provider==='gemini')url.pathname=url.pathname.replace(/\/openai$/,'').replace(/\/models\/[^/]+:generateContent$/,'');
  if(!url.pathname||url.pathname==='/')url.pathname=config.provider==='gemini'?'/v1beta':config.provider==='gemini-compatible'?'/v1beta/openai':'/v1';
  if(config.provider==='gemini-compatible'&&h==='generativelanguage.googleapis.com'&&!url.pathname.endsWith('/openai'))url.pathname+='/openai';
  return url;
}
export function authHeaders(config:ApiConfig,key:string):Record<string,string>{
  const mode=config.authMode==='auto'?(config.provider==='gemini'?'x-goog-api-key':'bearer'):config.authMode;
  return {'Content-Type':'application/json',...(mode==='bearer'?{Authorization:`Bearer ${key}`}:{[mode==='authorization'?'Authorization':mode]:key})};
}
export function reasoningChoices(config:ApiConfig):string[]{
  if(config.provider==='deepseek')return ['default','none','low','high','max'];
  if(config.provider==='gemini'||config.provider==='gemini-compatible')return config.model.includes('2.5-pro')?['default','low','medium','high']:config.model.includes('2.5')?['default','none','low','medium','high']:['default','minimal','low','medium','high'];
  return ['default','none','minimal','low','medium','high','xhigh','max'];
}
export function numericParameters(config:ApiConfig):{temperature?:number;topP?:number;topK?:number}{
  const result:{temperature?:number;topP?:number;topK?:number}={};
  for(const [field,min,max] of [['temperature',0,2],['topP',0,1],['topK',1,1000]] as const){if(config[field].trim()==='')continue;const value=Number(config[field]);if(!Number.isFinite(value)||value<min||value>max||(field==='topK'&&!Number.isInteger(value)))throw Error(`${field} 参数范围应为 ${min}–${max}${field==='topK'?' 的整数':''}。`);result[field]=value;}
  if(result.topK!==undefined&&!['gemini','custom'].includes(config.provider))throw Error('当前接口不支持 top K；请清空该参数，或选择 Gemini 原生接口。');
  if(!reasoningChoices(config).includes(config.reasoning))throw Error('当前模型不支持所选思考强度，请重新选择。');
  if(!Number.isInteger(config.maxTokens)||config.maxTokens<512||config.maxTokens>65536)throw Error('最大输出 tokens 必须是 512–65536 的整数。');
  return result;
}
export function generationRequest(config:ApiConfig,key:string,prompt:string){
  const url=apiBase(config),p=numericParameters(config),notes:string[]=[];
  if(!config.model.trim()||config.model.length>200||!/^[-A-Za-z0-9_./:]+$/.test(config.model))throw Error('模型名称为空或包含不支持的字符。');
  let body:Record<string,unknown>;
  if(config.provider==='gemini'){
    url.pathname+=`/models/${config.model.replace(/^models\//,'')}:generateContent`;
    const generationConfig:Record<string,unknown>={maxOutputTokens:config.maxTokens,...p};
    if(config.reasoning!=='default')generationConfig.thinkingConfig=config.model.includes('2.5')?{thinkingBudget:({none:0,low:1024,medium:8192,high:24576} as Record<string,number>)[config.reasoning]}:{thinkingLevel:config.reasoning.toUpperCase()};
    body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig};
  }else{
    url.pathname+='/chat/completions';body={model:config.model,messages:[{role:'system',content:'You are a character-setting editor. Follow the requested output format.'},{role:'user',content:prompt}],stream:false,max_tokens:config.maxTokens};
    const deepThinking=config.provider==='deepseek'&&config.reasoning!=='none';
    if(config.provider==='deepseek'&&config.reasoning!=='default')body.thinking={type:config.reasoning==='none'?'disabled':'enabled'};
    if(config.reasoning!=='default'&&!(config.provider==='deepseek'&&config.reasoning==='none'))body.reasoning_effort=config.reasoning;
    if(deepThinking&&(p.temperature!==undefined||p.topP!==undefined))notes.push('DeepSeek 思考模式不使用 temperature / top P，本次未发送这两个参数。');
    if(!deepThinking){if(p.temperature!==undefined)body.temperature=p.temperature;if(p.topP!==undefined)body.top_p=p.topP;}
    if(p.topK!==undefined)body.top_k=p.topK;
  }
  return {url,headers:authHeaders(config,key),body,notes};
}
export function configForStorage(config:ApiConfig,key:string){return {version:2,...config,...(config.rememberKey&&key?{key:normalizeKey(key)}:{})};}
