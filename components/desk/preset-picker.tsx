'use client';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { CREATION_PRESETS, importPreset, type CreationPreset } from '@/lib/presets';
import { toast } from 'sonner';
export function PresetPicker({value,onChange,disabled}:{value?:CreationPreset;onChange:(p:CreationPreset)=>void;disabled:boolean}){
 const input=useRef<HTMLInputElement>(null),preset=value||CREATION_PRESETS[0];
 return <div className="preset-picker"><Label htmlFor="creation-preset">创作预设</Label><div className="api-model-row"><Select value={preset.id} disabled={disabled} onValueChange={id=>onChange(CREATION_PRESETS.find(p=>p.id===id)||{id:'custom',name:'自定义创作预设/破甲预设',text:preset.text})}><SelectTrigger id="creation-preset" className="wide"><SelectValue/></SelectTrigger><SelectContent>{CREATION_PRESETS.map(p=><SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}<SelectItem value="custom">自定义创作预设/破甲预设</SelectItem></SelectContent></Select><Button variant="outline" disabled={disabled} onClick={()=>input.current?.click()}>导入</Button></div><Textarea aria-label="创作预设内容" rows={3} maxLength={20000} value={preset.text} disabled={disabled} onChange={e=>onChange({id:'custom',name:'自定义创作预设/破甲预设',text:e.target.value})}/><p className="muted-note">填写自定义提示词，随创作、改写和反馈请求发送并随项目保存；连接测试不使用此预设。</p><input hidden ref={input} type="file" accept=".txt,.md,.json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>100000)throw Error('预设文件不能超过 100 KB。');onChange(importPreset(await file.text(),file.name));toast.success('已导入创作预设');}catch(error){toast.error(error instanceof Error?error.message:'预设读取失败');}finally{if(input.current)input.current.value='';}}}/></div>;
}
