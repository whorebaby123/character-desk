'use client';
import { useRef, useState } from 'react';
import { PlugZap, RefreshCw, Eye, EyeOff, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PROVIDERS, defaultApiConfig, normalizeKey, reasoningChoices, type ApiConfig, type AuthMode } from '@/lib/api-config';
export type ConnectionStatus={fingerprint:string;state:'success'|'error';message:string};
export const configFingerprint=(config:ApiConfig,key:string)=>JSON.stringify({...config,key});
type Props={open:boolean;onClose:()=>void;config:ApiConfig;onChange:(c:ApiConfig)=>void;apiKey:string;onKeyChange:(k:string)=>void;onSave:()=>void;onForget:()=>void;onStatus:(s:ConnectionStatus)=>void};
export function ApiSettings({open,onClose,config,onChange,apiKey,onKeyChange,onSave,onForget,onStatus}:Props){
 const [working,setWorking]=useState(''),[reveal,setReveal]=useState(false),[modelLists,setModelLists]=useState<Record<string,{id:string;label:string;topK?:number}[]>>({}),[report,setReport]=useState<{fingerprint:string;message:string;ok:boolean}|null>(null);
 const controller=useRef<AbortController|null>(null);
 const scope=config.provider+'|'+config.baseURL;
 const preset=PROVIDERS.find(p=>p.id===config.provider)!;
 const models=modelLists[scope]||preset.models.map(id=>({id,label:id}));
 const currentFingerprint=configFingerprint(config,apiKey),currentReport=report?.fingerprint===currentFingerprint?report:null;
 const choices=reasoningChoices(config);
 function patch(next:Partial<ApiConfig>){onChange({...config,...next});}
 function provider(id:string){const p=PROVIDERS.find(p=>p.id===id)!;onChange({...defaultApiConfig,rememberKey:config.rememberKey,provider:p.id,baseURL:p.url,model:p.models[0]||''});onKeyChange('');setReport(null);}
 async function connect(action:'test'|'models'){
   let key:string;try{key=normalizeKey(apiKey);}catch(e){toast.error(e instanceof Error?e.message:'密钥无效');return;}
   const fp=configFingerprint(config,apiKey);setWorking(action);const abort=new AbortController();controller.current=abort;
   try{const response=await fetch('/api/connection',{method:'POST',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,key,action})});let data;try{data=await response.json();}catch{throw Error('本站未返回 JSON。请刷新登录状态后重试。');}if(!response.ok)throw Error(`${data.error||'连接失败'}${data.code?' ['+data.code+']':''}`);
     if(action==='models'){if(!Array.isArray(data.models))throw Error('模型列表格式不正确。');setModelLists(prev=>({...prev,[scope]:data.models}));toast.success(`读取到 ${data.models.length} 个模型${data.partial?'（部分列表）':''}`);}
     else{if(data.success!==true)throw Error('服务未确认测试成功。');const message=`连接成功 · ${data.model} · ${(data.elapsedMs/1000).toFixed(2)} 秒${data.notes?.length?'。'+data.notes.join('；'):''}`;setReport({fingerprint:fp,message,ok:true});onStatus({fingerprint:fp,state:'success',message});toast.success('模型调用测试通过');}
   }catch(e){const message=abort.signal.aborted?'已停止测试。':e instanceof Error?e.message:'连接失败';setReport({fingerprint:fp,message,ok:false});if(action==='test')onStatus({fingerprint:fp,state:'error',message});toast.error(message);}
   finally{setWorking('');controller.current=null;}
 }
 return <Dialog open={open} onOpenChange={v=>{if(!v){controller.current?.abort();onClose();}}}><DialogContent className="large-dialog"><DialogHeader><DialogTitle>API 连接与生成参数</DialogTitle><DialogDescription>恢复上次配置后即可继续使用。“测试连接”会实际请求当前模型生成一条短回复，可能产生少量费用。</DialogDescription></DialogHeader>
 <div className="tool-form api-form"><Label htmlFor="provider">服务商 / 接口</Label><Select value={config.provider} disabled={!!working} onValueChange={provider}><SelectTrigger id="provider" className="wide"><SelectValue/></SelectTrigger><SelectContent>{PROVIDERS.map(p=><SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent></Select>
 <Label htmlFor="base">API 地址</Label><Input id="base" value={config.baseURL} disabled={!!working} placeholder="https://你的服务商域名/v1" onChange={e=>patch({baseURL:e.target.value})}/>
 <Label htmlFor="model-select">模型快捷选择</Label><div className="api-model-row"><Select value={models.some(m=>m.id===config.model)?config.model:'__custom__'} disabled={!!working} onValueChange={v=>{if(v!=='__custom__')patch({model:v,reasoning:'default'});}}><SelectTrigger id="model-select" className="wide"><SelectValue/></SelectTrigger><SelectContent>{models.map(m=><SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>)}<SelectItem value="__custom__">手动输入模型 ID</SelectItem></SelectContent></Select><Button variant="outline" disabled={!!working||!apiKey} onClick={()=>connect('models')}><RefreshCw/>{working==='models'?'读取中':'读取模型'}</Button></div>
 <Input aria-label="模型 ID" value={config.model} disabled={!!working} placeholder="可以手动输入其他模型 ID" onChange={e=>patch({model:e.target.value,reasoning:'default'})}/><p className="muted-note">预填项供快捷选择，实际可用性以你的密钥和“读取模型”为准。</p>
 <Label htmlFor="key">Key / Authorization</Label><div className="api-model-row"><Input id="key" type={reveal?'text':'password'} autoComplete="off" value={apiKey} disabled={!!working} placeholder="原始 Key，或 Authorization: Bearer …" onChange={e=>onKeyChange(e.target.value)}/><Button variant="ghost" aria-label={reveal?'隐藏密钥':'显示密钥'} onClick={()=>setReveal(v=>!v)}>{reveal?<EyeOff/>:<Eye/>}</Button></div>
 <Label htmlFor="auth-mode">认证方式</Label><Select value={config.authMode} disabled={!!working} onValueChange={v=>patch({authMode:v as AuthMode})}><SelectTrigger id="auth-mode" className="wide"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="auto">自动（根据接口类型）</SelectItem><SelectItem value="bearer">Authorization: Bearer Key</SelectItem><SelectItem value="x-goog-api-key">x-goog-api-key: Key</SelectItem><SelectItem value="x-api-key">x-api-key: Key</SelectItem><SelectItem value="key">Key: Key</SelectItem><SelectItem value="authorization">Authorization: Key（无 Bearer）</SelectItem></SelectContent></Select>
 <Label className="remember-api"><Checkbox checked={config.rememberKey} disabled={!!working} onCheckedChange={v=>patch({rememberKey:v===true})}/>记住此设备的密钥，下次打开恢复</Label><p className="muted-note">地址、模型和参数始终保存在当前浏览器；勾选后密钥也保存在本机站点数据中。不会放入角色卡或项目备份。</p>
 <div className="api-parameters"><div><Label htmlFor="thinking">思考强度</Label><Select value={choices.includes(config.reasoning)?config.reasoning:'default'} disabled={!!working} onValueChange={v=>patch({reasoning:v})}><SelectTrigger id="thinking" className="wide"><SelectValue/></SelectTrigger><SelectContent>{choices.map(v=><SelectItem key={v} value={v}>{{default:'模型默认',none:'关闭',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高'}[v]}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="tokens">最大输出 tokens</Label><Input id="tokens" type="number" min={512} max={65536} disabled={!!working} value={config.maxTokens} onChange={e=>patch({maxTokens:Number(e.target.value)})}/></div><div><Label htmlFor="temperature">温度 temperature</Label><Input id="temperature" type="number" min={0} max={2} step={0.1} value={config.temperature} disabled={!!working} placeholder="留空使用模型默认" onChange={e=>patch({temperature:e.target.value})}/></div><div><Label htmlFor="top-p">Top P</Label><Input id="top-p" type="number" min={0} max={1} step={0.05} value={config.topP} disabled={!!working} placeholder="留空使用模型默认" onChange={e=>patch({topP:e.target.value})}/></div><div><Label htmlFor="top-k">Top K</Label><Input id="top-k" type="number" min={1} max={1000} step={1} value={config.topK} disabled={!!working||!['gemini','custom'].includes(config.provider)} placeholder={['gemini','custom'].includes(config.provider)?'留空不发送':'当前接口不支持'} onChange={e=>patch({topK:e.target.value})}/></div></div>
 <p className="muted-note">参数支持因模型而异。Gemini 原生可传 top K，但部分模型不支持；DeepSeek 思考模式下温度和 top P 不生效。留空表示不发送该参数。</p>
 {currentReport&&<div className={currentReport.ok?'api-test-success':'api-test-error'} role="status">{currentReport.message}</div>}
 {!currentReport&&<p className="muted-note">当前配置尚未在本次页面验证。</p>}
 <div className="dialog-actions"><Button variant="ghost" disabled={!!working} onClick={onForget}>忘记已保存密钥</Button>{working?<Button variant="outline" onClick={()=>controller.current?.abort()}><Square/>停止</Button>:<Button variant="outline" onClick={()=>connect('test')}><PlugZap/>测试连接</Button>}<Button disabled={!!working} onClick={onSave}>保存并使用</Button></div>
 </div></DialogContent></Dialog>;
}
