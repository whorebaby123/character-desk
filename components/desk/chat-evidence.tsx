'use client';
import { useRef, useState } from 'react';
import { Upload, MessagesSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { toast } from 'sonner';
import { parseChat, latestSelection, evidenceText, MAX_CHAT_CHARS, type ChatAttachment } from '@/lib/chat';

type Props = { value?: ChatAttachment; onChange: (value?: ChatAttachment) => void; disabled?: boolean };
export function ChatEvidence({value,onChange,disabled}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[reading,setReading]=useState(false),[page,setPage]=useState(0),[from,setFrom]=useState('1'),[to,setTo]=useState('20');
  const amount = value ? evidenceText({...value,enabled:true}).length : 0;
  const blocked=disabled||reading;
  const pages = value ? Math.ceil(value.log.messages.length / 50) : 0;
  const currentPage = Math.max(0,Math.min(page,pages-1));
  async function read(file?: File) {
    if(!file)return;
    if(file.size>10*1024*1024){toast.error('对话文件不能超过 10 MB。');if(input.current)input.current.value='';return;}
    setReading(true);
    try {
      const log=parseChat(await file.text(),file.name),selected=latestSelection(log);
      onChange({log,selected,enabled:true});
      setFrom(String(selected[0]||1));setTo(String(selected.at(-1)||Math.min(20,log.messages.length)));
      setPage(Math.floor(((selected[0]||1)-1)/50));setOpen(true);
      toast.success(`已读取 ${log.messages.length} 条消息，请确认分析范围。`);
    } catch(e) {toast.error(e instanceof Error?e.message:'读取失败');}
    finally {setReading(false);if(input.current)input.current.value='';}
  }
  function range(){
    if(!value)return;const start=Number(from),end=Number(to);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>value.log.messages.length){toast.error('请输入有效的消息起止编号。');return;}
    onChange({...value,selected:value.log.messages.filter(m=>m.id>=start&&m.id<=end).map(m=>m.id)});setPage(Math.floor((start-1)/50));
  }
  return <div className="chat-evidence">
    <input type="file" ref={input} hidden accept=".jsonl,.json,.txt,.md" onChange={e=>read(e.target.files?.[0])}/>
    <div className="chat-evidence-title"><MessagesSquare size={17}/><strong>导入酒馆对话</strong><span>可选</span></div>
    <p className="muted-note">选择出问题的消息及前后文，帮助判断原因。</p>
    {!value ? <Button variant="outline" disabled={blocked} className="wide" onClick={()=>input.current?.click()}><Upload/>{reading?'正在读取…':'选择对话文件'}</Button> : <>
      <div className="chat-file-name">{value.log.filename}</div>
      <Label className="chat-enable"><Checkbox checked={value.enabled} disabled={blocked} onCheckedChange={v=>onChange({...value,enabled:v===true})}/>将所选对话加入本次反馈分析</Label>
      <p className={amount>MAX_CHAT_CHARS?'chat-over-limit':'muted-note'} role="status">已选 {value.selected.length} / {value.log.messages.length} 条 · {amount.toLocaleString()} 字符{amount>MAX_CHAT_CHARS?'，请缩小范围':''}</p>
      <div className="chat-actions"><Button variant="outline" disabled={blocked} onClick={()=>setOpen(true)}>选择与预览</Button><Button variant="ghost" disabled={blocked} onClick={()=>input.current?.click()}>更换</Button><Button variant="ghost" disabled={blocked} aria-label="移除导入对话" onClick={()=>onChange(undefined)}><X/></Button></div>
    </>}
    <p className="muted-note">支持 JSONL / JSON / TXT。只在点击反馈分析时发送所选消息；对话暂存于当前页面，不写入人物设定。</p>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="large-dialog chat-dialog"><DialogHeader><DialogTitle>选择用于分析的对话</DialogTitle><DialogDescription>默认选择可容纳的最近 20 条非系统消息。建议同时选择问题回复之前的用户输入。最多 {MAX_CHAT_CHARS.toLocaleString()} 字符。</DialogDescription></DialogHeader>
      {value&&<>
        {value.log.notices.map((notice,i)=><p className="muted-note" key={i}>{notice}</p>)}
        <div className="chat-range"><Label htmlFor="chat-from">从第</Label><Input id="chat-from" type="number" min={1} max={value.log.messages.length} value={from} onChange={e=>setFrom(e.target.value)}/><Label htmlFor="chat-to">至第</Label><Input id="chat-to" type="number" min={1} max={value.log.messages.length} value={to} onChange={e=>setTo(e.target.value)}/><span>条</span><Button variant="outline" onClick={range} disabled={blocked}>选中范围</Button></div>
        <div className="chat-actions"><Button variant="ghost" disabled={blocked} onClick={()=>{const selected=latestSelection(value.log);onChange({...value,selected});setPage(Math.floor(((selected[0]||1)-1)/50));}}>最近 20 条</Button><Button variant="ghost" disabled={blocked} onClick={()=>onChange({...value,selected:[]})}>清空选择</Button><span className={amount>MAX_CHAT_CHARS?'chat-over-limit':'muted-note'}>已选 {value.selected.length} 条 · {amount.toLocaleString()} 字符</span></div>
        <div className="chat-message-list">{value.log.messages.slice(currentPage*50,(currentPage+1)*50).map(message=><article key={message.id} className={`chat-message ${value.selected.includes(message.id)?'chosen':''}`}><Label className="chat-message-label"><Checkbox disabled={blocked} checked={value.selected.includes(message.id)} onCheckedChange={checked=>onChange({...value,selected:checked===true?[...value.selected,message.id]:value.selected.filter(id=>id!==message.id)})}/><span>#{message.id} · {message.name}</span><small>{{user:'用户',assistant:'角色',system:'系统',unknown:'未标注角色'}[message.role]}</small></Label><pre>{message.text}</pre></article>)}</div>
        <Pagination aria-label="对话消息分页"><PaginationContent><PaginationItem><Button variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</Button></PaginationItem><PaginationItem><span className="chat-page-count">{currentPage+1} / {pages}</span></PaginationItem><PaginationItem><Button variant="outline" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</Button></PaginationItem></PaginationContent></Pagination>
        <div className="dialog-actions"><Button disabled={value.enabled&&(!value.selected.length||amount>MAX_CHAT_CHARS)} onClick={()=>setOpen(false)}>完成选择</Button></div>
      </>}
    </DialogContent></Dialog>
  </div>;
}
