'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import type { Section } from '@/lib/project';
import { triggerBase, triggerPrompt, parseTriggerWords, type TriggerSuggestion } from '@/lib/trigger-words';

export function TriggerSuggestions({section,busy,onBusy,onGenerate,onApply}:{section:Section;busy:boolean;onBusy:(v:boolean)=>void;onGenerate:(prompt:string,signal:AbortSignal)=>Promise<string>;onApply:(words:string[],base:string)=>void}) {
    const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[base,setBase]=useState('');
    const [suggestions,setSuggestions]=useState<TriggerSuggestion[]>([]),[selected,setSelected]=useState<string[]>([]),[raw,setRaw]=useState(''),[message,setMessage]=useState('');
    const controller=useRef<AbortController|null>(null);
    useEffect(()=>()=>controller.current?.abort(),[]);
    const stale=!!base && base!==triggerBase(section);
    function receive(text:string,sourceBase:string) {
        const result=parseTriggerWords(text,section.keys||[]);
        setSuggestions(result);setSelected([]);setBase(sourceBase);
        setMessage(result.length?'勾选要添加的词，已有触发词会保留。':'没有新的可用触发词，可调整条目内容后再试。');
    }
    async function generate() {
        setOpen(true);setMessage('');
        let prompt;try{prompt=triggerPrompt(section);}catch(e){setMessage((e as Error).message);return;}
        const c=new AbortController();controller.current=c;setPending(true);onBusy(true);
        try { const text=await onGenerate(prompt,c.signal);if(c.signal.aborted)return;setRaw(text);receive(text,triggerBase(section)); }
        catch(e){if(!c.signal.aborted)setMessage((e as Error).message);}
        finally {setPending(false);onBusy(false);controller.current=null;}
    }
    async function copyPrompt(){try{await navigator.clipboard.writeText(triggerPrompt(section));toast.success('已复制触发词提示词');}catch(e){setMessage((e as Error).message);}}
    return <div className="trigger-suggestions">
        <Button type="button" variant="outline" disabled={busy||section.locked} onClick={()=>open?setOpen(false):generate()}><Sparkles size={14}/>{open?'收起建议':'建议触发词'}</Button>
        {open&&<div className="trigger-panel" aria-label="触发词建议">
            <p className="muted-note">根据当前条目名称与正文建议具体词语，点击添加后才会生效。{section.constant?'此条目为常驻，触发词用于切换为按需触发后的匹配。':''}</p>
            {pending?<div className="trigger-actions" role="status">正在分析条目…<Button variant="outline" onClick={()=>controller.current?.abort()}>停止</Button></div>:<div className="trigger-actions"><Button variant="outline" disabled={busy||section.locked} onClick={generate}>重新建议</Button><Button variant="ghost" disabled={busy||section.locked} onClick={copyPrompt}>复制提示词</Button></div>}
            {message&&<p className="muted-note" role="status">{message}</p>}
            {stale&&<p className="study-warning">条目已修改，请重新生成建议。</p>}
            {suggestions.map(item=><Label className="trigger-candidate" key={item.word}><Checkbox disabled={busy||section.locked||stale} checked={selected.includes(item.word)} onCheckedChange={v=>setSelected(words=>v===true?[...words,item.word]:words.filter(w=>w!==item.word))}/><span><strong>{item.word}</strong><small>{item.reason}</small></span></Label>)}
            {!!suggestions.length&&<Button disabled={busy||section.locked||stale||!selected.length} onClick={()=>{onApply(selected,base);setSuggestions([]);setSelected([]);setBase('');setMessage('已添加，可在触发词输入框中继续编辑。');}}>添加所选（{selected.length}）</Button>}
            <details className="trigger-manual"><summary>粘贴外部 AI 的建议</summary><Textarea aria-label="触发词建议 JSON" value={raw} disabled={busy||section.locked} onChange={e=>setRaw(e.target.value)} placeholder={'{"suggestions":[{"word":"词语","reason":"理由"}]}'}/><Button variant="outline" disabled={busy||section.locked||!raw.trim()} onClick={()=>{try{receive(raw,triggerBase(section));}catch(e){setMessage((e as Error).message);}}}>读取建议</Button></details>
        </div>}
    </div>;
}
