'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, Copy, ArrowUp, Square, Download, Users, UserRound, Check, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { studyPrompt,parseStudy,adaptationTask,MAX_REFERENCE_CHARS,type ReferenceDraft,type Evidence,type StudyOptions } from '@/lib/reference';
import { makePrompt,parseProposal,type Project,type Proposal } from '@/lib/project';
type Props={project:Project;draft:ReferenceDraft;onChange:(d:ReferenceDraft)=>void;busy:boolean;onBusy:(b:boolean)=>void;onGenerate:(prompt:string,signal:AbortSignal)=>Promise<string>;onReview:(proposal:Proposal,base:string)=>void};
export function ReferenceStudy({project,draft,onChange,busy,onBusy,onGenerate,onReview}:Props){
 const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null);
 const [pending,setPending]=useState(''),[manual,setManual]=useState<'analysis'|'adapt'|null>(null),[prompt,setPrompt]=useState(''),[manualResult,setManualResult]=useState('');
 const manualBase=useRef('');
 useEffect(()=>()=>controller.current?.abort(),[]);
 const patch=(next:Partial<ReferenceDraft>,invalidate=false)=>onChange({...draft,...next,...(invalidate?{report:undefined,selected:[],raw:''}:{})});
 const selectedCount=draft.report?[...draft.report.characters,...draft.report.relationships].filter(f=>draft.selected.includes(f.id)).length:0;
 const total=draft.report?draft.report.characters.length+draft.report.relationships.length:0;
 async function read(file?:File){if(!file)return;setPending('读取文本');onBusy(true);try{if(file.size>10*1024*1024)throw Error('TXT 文件不能超过 10 MB。');const source=(await file.text()).replace(/^\uFEFF/,'');if(source.includes('\u0000')||source.includes('\ufffd'))throw Error('文件编码无法正确读取，请另存为 UTF-8 TXT 后导入。');patch({source,filename:file.name},true);toast.success(source.length>MAX_REFERENCE_CHARS?'已读取，请在文本框中保留本次要分析的片段':'文本已读取');}catch(e){toast.error(e instanceof Error?e.message:'文本读取失败');}finally{setPending('');onBusy(false);if(input.current)input.current.value='';}}
 function build(kind:'analysis'|'adapt'){return kind==='analysis'?studyPrompt(draft.source,draft):makePrompt(project,adaptationTask(project,draft));}
 function accept(raw:string,kind:'analysis'|'adapt',base=JSON.stringify(project)){
  if(kind==='analysis'){const report=parseStudy(raw,draft.source,draft.mode);patch({report,raw,selected:[...report.characters,...report.relationships].map(f=>f.id)});toast.success('分析完成，选择要参考的人物与关系');}
  else onReview(parseProposal(raw,project),base);
 }
 async function run(kind:'analysis'|'adapt'){
  let requestPrompt;try{requestPrompt=build(kind);}catch(e){toast.error(e instanceof Error?e.message:'请补充分析资料');return;}
  const base=JSON.stringify(project),abort=new AbortController();controller.current=abort;setPending(kind==='analysis'?'正在分析人物与关系':'正在生成套用建议');onBusy(true);
  try{const raw=await onGenerate(requestPrompt,abort.signal);try{accept(raw,kind,base);}catch(e){if(kind==='analysis')patch({raw});setPrompt(requestPrompt);setManualResult(raw);manualBase.current=base;setManual(kind);toast.error(e instanceof Error?e.message:'结果格式无效，已保留原文');}}
  catch(e){toast.error(abort.signal.aborted?'已停止等待':e instanceof Error?e.message:'请求失败');}
  finally{controller.current=null;setPending('');onBusy(false);}
 }
 async function copy(value:string){try{await navigator.clipboard.writeText(value);toast.success('已复制提示词');}catch{toast.info('请在提示词框中手动选择并复制。');}}
 function openManual(kind:'analysis'|'adapt'){try{setPrompt(build(kind));manualBase.current=JSON.stringify(project);setManualResult(kind==='analysis'?draft.raw:'');setManual(kind);}catch(e){toast.error(e instanceof Error?e.message:'请先补充资料');}}
 function toggle(id:string,checked:boolean){patch({selected:checked?[...draft.selected.filter(x=>x!==id),id]:draft.selected.filter(x=>x!==id)});}
 function exportReport(){if(!draft.report)return;const blob=new Blob([JSON.stringify(draft.report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='人物与关系分析.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const evidence=(items:Evidence[])=> <details className="source-evidence"><summary><Quote size={14}/>原文证据{!items.length?' · 未提供':''}</summary>{items.map((e,i)=><div key={i}><span className={e.verified?'evidence-verified':'evidence-unverified'}>{e.verified?<Check size={13}/>:null}第 {e.paragraph} 段 · {e.verified?'摘录已核对':'摘录未匹配'}</span><blockquote>{e.quote||'未提供摘录'}</blockquote></div>)}</details>;
 return <div className="reference-study">
  <div className="study-intro"><h2>读懂人物，再带入你的世界</h2><p>从文本中提炼人物特点与相处方式，按你的要求映射到当前设定。</p></div>
  <div className="tool-form">
   <Label htmlFor="reference-source">参考文本</Label>
   <div className="reference-source"><Textarea id="reference-source" rows={7} value={draft.source} disabled={busy} placeholder="粘贴小说片段、人物对话或其他参考文字…" onChange={e=>patch({source:e.target.value,filename:''},true)}/><div className="source-toolbar"><Button variant="ghost" disabled={busy} onClick={()=>input.current?.click()}><Upload size={15}/>导入 TXT</Button><span>{draft.filename||'粘贴文本'} · {draft.source.length.toLocaleString()} 字符</span>{draft.source&&<Button variant="ghost" disabled={busy} onClick={()=>patch({source:'',filename:''},true)}>清空</Button>}</div></div>
   <input hidden ref={input} type="file" accept=".txt,.md,text/plain" onChange={e=>read(e.target.files?.[0])}/>
   {draft.source.length>MAX_REFERENCE_CHARS&&<p className="study-warning">单次最多 {MAX_REFERENCE_CHARS.toLocaleString()} 字符。已保留全部导入文字，请删减为本次片段后分析。</p>}
   <div className="study-options"><div><Label htmlFor="study-mode">分析内容</Label><Select value={draft.mode} disabled={busy} onValueChange={mode=>patch({mode:mode as StudyOptions['mode']},true)}><SelectTrigger id="study-mode"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="both">人物形象与关系</SelectItem><SelectItem value="characters">只分析人物形象</SelectItem><SelectItem value="relationships">只分析人物关系</SelectItem></SelectContent></Select></div><div><Label htmlFor="relationship-kind">关系视角</Label><Select value={draft.relationshipKind} disabled={busy||draft.mode==='characters'} onValueChange={relationshipKind=>patch({relationshipKind},true)}><SelectTrigger id="relationship-kind"><SelectValue/></SelectTrigger><SelectContent>{['由文本与要求决定','恋爱 / 亲密关系','日常交流','友情','亲情','对立 / 竞争','其他（在要求中说明）'].map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div></div>
   <Label htmlFor="study-focus">重点人物或组合 <span>可选</span></Label><Input id="study-focus" value={draft.focus} disabled={busy} placeholder="例如：只分析林照，以及林照与陈望的相处" onChange={e=>patch({focus:e.target.value},true)}/>
   <Label htmlFor="study-requirements">你想看懂什么？ <span>可选</span></Label><Textarea id="study-requirements" rows={2} value={draft.requirements} disabled={busy} placeholder="例如：重点分析他们日常对话里的试探、关心和边界，不分析恋爱。" onChange={e=>patch({requirements:e.target.value},true)}/>
   <div className="study-actions"><Button variant="ghost" disabled={busy} onClick={()=>openManual('analysis')}><Copy size={15}/>手动分析</Button><Button disabled={busy||!draft.source.trim()||draft.source.length>MAX_REFERENCE_CHARS} onClick={()=>run('analysis')}><ArrowUp size={16}/>{draft.report?'重新分析':'开始分析'}</Button></div>
  </div>
  {pending&&<div className="study-pending" role="status"><span>{pending}…</span>{controller.current&&<Button variant="ghost" onClick={()=>controller.current?.abort()}><Square size={14}/>停止</Button>}</div>}
  {draft.report&&<section className="study-results"><div className="study-result-heading"><h3>分析结果</h3><Button variant="ghost" onClick={exportReport}><Download size={15}/>下载分析</Button></div><p className="study-summary">{draft.report.summary}</p>
   {draft.report.warnings.length>0&&<details className="study-uncertainty"><summary>推断与不确定之处（{draft.report.warnings.length}）</summary><ul>{draft.report.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
   <div className="study-selection"><Label><Checkbox disabled={busy} checked={selectedCount===total?true:selectedCount?'indeterminate':false} onCheckedChange={v=>patch({selected:v===true?[...draft.report!.characters,...draft.report!.relationships].map(f=>f.id):[]})}/>选择用于套用的分析</Label><span>{selectedCount} / {total}</span></div>
   {draft.report.characters.map(c=><article key={c.id} className="finding"><Label className="finding-title"><Checkbox disabled={busy} checked={draft.selected.includes(c.id)} onCheckedChange={v=>toggle(c.id,v===true)}/><UserRound size={17}/><strong>{c.name}</strong></Label><p>{c.portrait}</p><dl>{[['核心动机',c.motivation],['说话方式',c.speech],['行为特点',c.behavior]].filter(([,v])=>v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{evidence(c.evidence)}</article>)}
   {draft.report.relationships.map(c=><article key={c.id} className="finding"><Label className="finding-title"><Checkbox disabled={busy} checked={draft.selected.includes(c.id)} onCheckedChange={v=>toggle(c.id,v===true)}/><Users size={17}/><strong>{c.people.join(' 与 ')}</strong><span>{c.kind}</span></Label><p>{c.dynamic}</p><dl>{[['关系进程',c.progression],['相处方式',c.interaction]].filter(([,v])=>v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{evidence(c.evidence)}</article>)}
   <div className="adaptation-composer tool-form"><Label htmlFor="study-mapping">如何带入「{project.name}」？</Label><Textarea id="study-mapping" rows={3} value={draft.mapping} disabled={busy} placeholder="例如：将林照的克制套给我的角色陆川，将两人的日常相处方式套给陆川与周宁。保留现有身份和经历，不照搬原剧情。" onChange={e=>patch({mapping:e.target.value})}/><div className="study-actions"><Button variant="ghost" disabled={busy||!selectedCount} onClick={()=>openManual('adapt')}><Copy size={15}/>手动套用</Button><Button disabled={busy||!selectedCount||!draft.mapping.trim()} onClick={()=>run('adapt')}><ArrowUp size={16}/>生成套用建议</Button></div><p className="muted-note">套用到当前{project.kind==='world'?'世界书':'角色卡'}；先审核差异，再逐项应用。锁定模块保持原样。</p></div>
  </section>}
  <p className="study-session-note">参考文本与分析暂存于当前页面；离开前可下载分析结果。已应用的设定会自动保存。</p>
  <Dialog open={manual!==null} onOpenChange={v=>!v&&setManual(null)}><DialogContent className="large-dialog"><DialogHeader><DialogTitle>{manual==='analysis'?'手动分析文本':'手动生成套用建议'}</DialogTitle><DialogDescription>复制提示词到其他 AI，粘贴 JSON 结果后读取。</DialogDescription></DialogHeader><div className="tool-form"><Textarea aria-label="参考分析提示词" readOnly value={prompt} rows={4}/><Button variant="outline" onClick={()=>copy(prompt)}><Copy/>复制完整提示词</Button><Label htmlFor="study-manual-result">AI 返回结果</Label><Textarea id="study-manual-result" rows={8} value={manualResult} onChange={e=>setManualResult(e.target.value)}/><Button disabled={!manualResult.trim()} onClick={()=>{try{if(manual)accept(manualResult,manual,manualBase.current);setManual(null);}catch(e){toast.error(e instanceof Error?e.message:'结果无法读取');}}}>读取结果</Button></div></DialogContent></Dialog>
 </div>;
}
