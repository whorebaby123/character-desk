'use client';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { FileText, BookOpen, Plus, Upload, Download, Settings2, Sparkles, LockKeyhole, LockKeyholeOpen, History, ArrowUpRight, MessageSquareText, CheckCheck, Copy, RotateCcw, Trash2, Square, ChevronRight, CircleHelp, PanelLeftClose, PanelLeftOpen, PenLine, ScanText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Toaster, toast } from 'sonner';
import { ApiSettings, configFingerprint, type ConnectionStatus } from '@/components/desk/api-settings';
import { TriggerSuggestions } from '@/components/desk/trigger-suggestions';
import { triggerBase } from '@/lib/trigger-words';
import { ReferenceStudy } from '@/components/desk/reference-study';
import { blankReference, type ReferenceDraft } from '@/lib/reference';
import { PresetPicker } from '@/components/desk/preset-picker';
import { defaultApiConfig, restoreApiConfig, configForStorage, normalizeKey, type ApiConfig } from '@/lib/api-config';
import { CREATION_PRESETS } from '@/lib/presets';
import { ChatEvidence } from '@/components/desk/chat-evidence';
import { feedbackEvidence, type ChatAttachment } from '@/lib/chat';
import { blank, demo, uid, obj, importObject, validateProject, exportObject, convert, parseProposal, applyPatches, checks, makePrompt, readPNG, type Project, type Section, type Snapshot, type Proposal, type Task } from '@/lib/project';
type Review = {
    proposal: Proposal;
    base: string;
    selected: string[];
};
const STORAGE = 'character-desk:workspace:v1', CONFIG = 'character-desk:api:v1';
const initialTask: Task = { mode: 'generate', target: 'description', instruction: '', actual: '', expected: '', excerpt: '' };
const fingerprint = (p: Project) => JSON.stringify(p);
function download(name: string, data: unknown, type = 'application/json') {
    const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/[<>:"/\\|?*]/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const err = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试。';
export default function Desk() {
    const [project, setProject] = useState<Project | null>(null), [projects, setProjects] = useState<Project[]>([]), [histories, setHistories] = useState<Record<string, Snapshot[]>>({});
    const [selected, setSelected] = useState('description'), [ready, setReady] = useState(false), [saveStatus, setSaveStatus] = useState('正在读取');
    const [view,setView]=useState<'editor'|'assistant'>('assistant'),[sidebarOpen,setSidebarOpen]=useState(true);
    const [referenceByProject,setReferenceByProject]=useState<Record<string,ReferenceDraft>>({});
    const [panel, setPanel] = useState('create'), [task, setTask] = useState<Task>(initialTask), [modal, setModal] = useState(''), [newKind, setNewKind] = useState<'card' | 'world'>('card'), [newName, setNewName] = useState('');
    const [config, setConfig] = useState<ApiConfig>(defaultApiConfig), [apiKey, setAPIKey] = useState('');
    const [manual, setManual] = useState(''), [busy, setBusy] = useState(false), [review, setReview] = useState<Review | null>(null), [exportKind, setExportKind] = useState<'card' | 'world'>('card');
    const [deleteTarget, setDeleteTarget] = useState<'project' | 'section' | null>(null), [projectToDelete, setProjectToDelete] = useState<string | null>(null), [projectContext, setProjectContext] = useState<{ id: string; x: number; y: number } | null>(null), [projectSelectOpen, setProjectSelectOpen] = useState(false), [storageBlocked, setStorageBlocked] = useState(false);
    const [connectionStatus,setConnectionStatus] = useState<ConnectionStatus|null>(null);
    const [promptText, setPromptText] = useState('');
    const [chatByProject, setChatByProject] = useState<Record<string, ChatAttachment | undefined>>({});
    const fileInput = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null), manualBase = useRef(''), scopeRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const initTimer = setTimeout(() => {
        try {
            const stored = localStorage.getItem(STORAGE);
            if (stored) {
                const data = JSON.parse(stored);
                if (!Array.isArray(data.projects) || !data.projects.length)
                    throw Error('项目列表无效');
                const list = data.projects.map(validateProject);
                setProjects(list);
                const p = list.find((p: Project) => p.id === data.active) || list[0];
                setProject(p);
                setSelected(p.sections[0]?.id || '');
                const hs: Record<string, Snapshot[]> = {};
                for (const [id, versions] of Object.entries(obj(data.histories))) {
                    if (Array.isArray(versions))
                        hs[id] = versions.slice(0, 20).map(s => ({ ...obj(s), project: validateProject(obj(s).project) } as Snapshot));
                }
                setHistories(hs);
            }
            else {
                const p = blank();
                setProject(p);
                setProjects([p]);
            }
            const cfg = localStorage.getItem(CONFIG);
            if (cfg) {
                let c; try {c=JSON.parse(cfg);} catch {c={};} 
                const restored = restoreApiConfig(c); setConfig(restored); if(restored.rememberKey && typeof obj(c).key === 'string')setAPIKey(obj(c).key as string);
            }
        }
        catch {
            setStorageBlocked(true);
            setSaveStatus('原备份读取失败');
            toast.error('无法读取本机项目。为保护原数据，已暂停自动保存。请先下载原数据。');
            const p = blank();
            setProject(p);
            setProjects([p]);
        }
        setSidebarOpen(window.innerWidth>700);
        setReady(true);
        }, 0);
        return () => { clearTimeout(initTimer); abort.current?.abort(); };
    }, []);
    useEffect(() => {
        if (!ready || !project || storageBlocked)
            return;
        const pendingTimer = setTimeout(() => setSaveStatus('保存中…'), 0);
        const save = () => { try {
            const list = projects.some(p => p.id === project.id) ? projects.map(p => p.id === project.id ? project : p) : [project, ...projects];
            localStorage.setItem(STORAGE, JSON.stringify({ version: 1, active: project.id, projects: list, histories }));
            setSaveStatus('已保存到本机');
        }
        catch {
            setSaveStatus('保存失败，请备份');
            toast.error('本机存储不可用或空间不足，请立即下载项目备份。');
        } };
        const timer = setTimeout(save, 350);
        window.addEventListener('pagehide', save);
        return () => { clearTimeout(pendingTimer); clearTimeout(timer); window.removeEventListener('pagehide', save); };
    }, [ready, project, projects, histories, storageBlocked]);
    const section = project?.sections.find(s => s.id === selected), versions = project ? histories[project.id] || [] : [];
    function edit(next: Partial<Project>) { setProject(p => p ? { ...p, ...next, updated: new Date().toISOString() } : p); }
    function editSection(next: Partial<Section>) { if (!project || !section)
        return; edit({ sections: project.sections.map(s => s.id === selected ? { ...s, ...next } : s) }); }
    function snapshot(label: string, p = project) { if (!p)
        return; setHistories(h => ({ ...h, [p.id]: [{ id: uid(), time: new Date().toISOString(), label, project: structuredClone(p) }, ...(h[p.id] || [])].slice(0, 20) })); }
    function openProject(p: Project, extraHistory?: Snapshot[]) { if (project)
        setProjects(list => [p, ...list.filter(x => x.id !== p.id).map(x => x.id === project.id ? project : x)]);
    else
        setProjects([p]); setProject(p); setSelected(p.sections[0]?.id || ''); setReview(null); if (extraHistory)
        setHistories(h => ({ ...h, [p.id]: extraHistory })); setTask(initialTask); setModal(''); }
    function switchProject(id: string) { if (!project || id === project.id)
        return; const next = projects.find(p => p.id === id); if (next) {
        setProjects(list => list.map(p => p.id === project.id ? project : p));
        setProject(next);
        setSelected(next.sections[0]?.id || '');
        setReview(null);
        setTask(initialTask);
    } }
    function requestProjectDeletion(id: string) {
        if (busy) return;
        setProjectContext(null);
        setProjectToDelete(id);
        setDeleteTarget('project');
    }
    function showProjectContext(event: MouseEvent, id: string) {
        if (busy) return;
        event.preventDefault();
        event.stopPropagation();
        setProjectSelectOpen(false);
        setProjectContext({ id, x: Math.min(event.clientX, window.innerWidth - 186), y: Math.min(event.clientY, window.innerHeight - 62) });
    }
    async function importFile(file?: File) {
        if (!file)
            return;
        if (file.size > 10 * 1024 * 1024) {
            toast.error('文件请控制在 10 MB 以内。');
            return;
        }
        try {
            let p: Project;
            let history: Snapshot[] = [];
            if (/\.png$/i.test(file.name)) {
                p = importObject(await readPNG(await file.arrayBuffer()), file.name);
            }
            else if (/\.(txt|md)$/i.test(file.name)) {
                p = blank(project?.kind || 'card');
                p.name = file.name.replace(/\.[^.]+$/, '');
                p.sections[0].text = await file.text();
                p.source = file.name;
            }
            else {
                const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
                p = importObject(data, file.name);
                if (data.spec === 'character-desk-backup' && Array.isArray(data.history))
                    history = data.history.slice(0, 20).map((v: Snapshot) => ({ ...v, project: validateProject(v.project) }));
            }
            p.id = uid();
            history = history.map(v => ({ ...v, project: { ...v.project, id: p.id } }));
            openProject(p, history);
            toast.success(`已读取 ${file.name}，作为独立项目打开。`);
        }
        catch (e) {
            toast.error(err(e));
        }
        finally {
            if (fileInput.current)
                fileInput.current.value = '';
        }
    }
    function taskFor(mode: Task['mode']): Task { return { ...task, mode, target: selected, creationPreset: project?.creationPreset || CREATION_PRESETS[0], chatEvidence: mode === 'feedback' && project ? feedbackEvidence(chatByProject[project.id]) : undefined }; }
    async function copy(text: string) { try {
        await navigator.clipboard.writeText(text);
        toast.success('已复制');
    }
    catch {
        toast.error('浏览器未允许复制，请在文字框内手动选中复制。');
    } }
    function openManual(mode: Task['mode']) {
        if (!project) return;
        try {
            const prompt = makePrompt(project, taskFor(mode));
            scopeRef.current = mode === 'rewrite' ? selected : undefined;
            setPromptText(prompt); manualBase.current = fingerprint(project);
            setTask(t => ({ ...t, mode, target: selected })); setManual(''); setModal('manual');
        } catch (e) { toast.error(err(e)); }
    }
    function reviewText(text: string, base: string) { if (!project)
        return; const proposal = parseProposal(text, project, scopeRef.current); setReview({ proposal, base, selected: proposal.patches.filter(p => !project.sections.find(s => s.id === p.id)?.locked).map(p => p.id) }); setModal('review'); }
    async function requestModelText(prompt:string,signal:AbortSignal):Promise<string>{
        if(!config.baseURL||!config.model||!apiKey){setModal('api');throw Error('请先填写 API 设置，或使用手动分析。');}
        const response=await fetch('/api/generate',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...config,key:apiKey,prompt})});
        let data;try{data=await response.json();}catch{throw Error('网站返回格式异常，请刷新后重试。');}
        if(!response.ok)throw Error((data.error||'请求失败')+(data.code?' ['+data.code+']':''));
        if(typeof data.text!=='string')throw Error('模型未返回有效文本。');
        setConnectionStatus({fingerprint:configFingerprint(config,apiKey),state:'success',message:'最近一次模型请求成功'});
        if(data.notes?.length)toast.info(data.notes.join('；'));
        return data.text;
    }
    async function run(mode: Task['mode']) {
        if (!project)
            return;
        if (mode === 'feedback' && (!task.actual.trim() || !task.expected.trim())) {
            toast.error('请先填写实际问题和希望的表现。');
            return;
        }
        let prompt: string;
        try { prompt = makePrompt(project, taskFor(mode)); } catch (e) { toast.error(err(e)); return; }
        if (!config.baseURL || !config.model || !apiKey) {
            setModal('api');
            toast.info('先填写 API 配置，也可以使用“复制提示词”手动生成。');
            return;
        }
        const base = fingerprint(project);
        scopeRef.current = mode === 'rewrite' ? selected : undefined;
        setBusy(true);
        const controller = new AbortController();
        abort.current = controller;
        try {
            const response = await fetch('/api/generate', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, key: apiKey, prompt }) });
            const data = await response.json();
            if (!response.ok)
                throw Error((data.error || '请求失败')+(data.code?' ['+data.code+']':''));
            try {
                setConnectionStatus({fingerprint:configFingerprint(config,apiKey),state:'success',message:'最近一次模型请求成功'});
                if(data.notes?.length)toast.info(data.notes.join('；'));
                reviewText(data.text, base);
            }
            catch (e) {
                setManual(data.text);
                manualBase.current = base;
                setPromptText(prompt);
                setModal('manual');
                toast.error(`模型结果未通过格式检查：${err(e)} 原始结果已保留。`);
            }
        }
        catch (e) {
            if (controller.signal.aborted)
                toast.info('已停止等待；服务商可能仍会计费。');
            else {
                setConnectionStatus({fingerprint:configFingerprint(config,apiKey),state:'error',message:err(e)});
                toast.error(err(e));
            }
        }
        finally {
            setBusy(false);
            abort.current = null;
        }
    }
    function applyReview() {
        if (!project || !review)
            return;
        if (fingerprint(project) !== review.base) {
            toast.error('设定已在生成后改变，请重新生成建议，避免覆盖新内容。');
            return;
        }
        const patches = review.proposal.patches.filter(p => review.selected.includes(p.id) && !project.sections.find(s => s.id === p.id)?.locked);
        if (!patches.length) {
            toast.info('没有选中可应用的修改。');
            return;
        }
        snapshot('应用建议前 · ' + review.proposal.summary.slice(0, 50));
        setProject(applyPatches(project, patches));
        setView('editor');
        setModal('');
        setReview(null);
        toast.success(`已应用 ${patches.length} 处修改，可在版本记录中恢复。`);
    }
    function addSection() { if (!project)
        return; snapshot('新增条目前'); const s: Section = { id: `${project.kind === 'card' ? 'book:' : 'entry:'}${uid()}`, label: '新人物条目', text: '', locked: false, keys: [project.name], constant: false, disabled: false }; edit({ sections: [...project.sections, s] }); setSelected(s.id);setView('editor'); }
    function backup() { if (!project)
        return; download(`${project.name}.backup.json`, { spec: 'character-desk-backup', version: 1, project, history: versions }); }
    if (!project)
        return <div className="boot">正在打开人物工作台…</div>;
    const count = project.sections.reduce((n, s) => n + s.text.length, 0), warnings = checks(project);
    const exportProject = exportKind === project.kind ? project : convert(project, exportKind), exportData = exportObject(exportProject);
    return <div className={`app-shell ${sidebarOpen?'':'sidebar-collapsed'}`}>
 <Toaster position="bottom-right" richColors closeButton/>
 <input ref={fileInput} type="file" accept=".json,.png,.txt,.md" hidden onChange={e => importFile(e.target.files?.[0])}/>
 <header className="topbar"><Button variant="ghost" className="sidebar-toggle" aria-label={sidebarOpen?'收起侧栏':'展开侧栏'} aria-expanded={sidebarOpen} onClick={()=>setSidebarOpen(v=>!v)}>{sidebarOpen?<PanelLeftClose/>:<PanelLeftOpen/>}</Button><div className="brand" aria-label="人物工作台"><span>人物工作台</span></div><span className="header-project" title={project.name}>{project.name}</span><div className="top-actions"><span className="local-status" role="status">{saveStatus}</span><Button variant="ghost" onClick={() => setModal('history')} disabled={busy}><History />版本</Button><Button variant="ghost" onClick={() => setModal('api')}><Settings2 />API 设置</Button><Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}><Upload />读取文件</Button><Button onClick={() => { setExportKind(project.kind); setModal('export'); }}><Download />导出</Button></div></header>
 {storageBlocked && <div className="storage-banner">自动保存已暂停。<Button variant="outline" onClick={() => download('character-desk-recovery.txt', localStorage.getItem(STORAGE) || '', 'text/plain')}>下载原数据</Button><Button variant="outline" onClick={() => { try {
        localStorage.setItem(STORAGE, JSON.stringify({ version: 1, active: project.id, projects: [project], histories: {} }));
        setProjects([project]);
        setHistories({});
        setStorageBlocked(false);
        toast.success('已使用当前项目重新启用保存');
    }
    catch {
        toast.error('存储仍不可用，请下载项目备份。');
    } }}>用当前项目重新保存</Button></div>}

 <main className="workspace">
 <aside className="outline-panel"> <div className="projectbar"><div className="project-picker"><span className="overline">当前项目</span><Select value={project.id} open={projectSelectOpen} onOpenChange={setProjectSelectOpen} onValueChange={switchProject} disabled={busy}><SelectTrigger aria-label="选择项目" title="选择项目；右键项目可删除" onContextMenu={event => showProjectContext(event, project.id)}><SelectValue>{project.name}</SelectValue></SelectTrigger><SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id} onContextMenu={event => showProjectContext(event, p.id)}>{p.id === project.id ? project.name : p.name}</SelectItem>)}</SelectContent></Select><span className={`kind-tag ${project.kind}`}>{project.kind === 'card' ? '角色卡' : '世界书'}</span></div><div className="project-actions"><Button variant="ghost" onClick={() => { const p = demo(); p.source = '内置示例'; openProject(p); }} disabled={busy}>打开示例</Button><Button variant="outline" onClick={() => setModal('new')} disabled={busy}><Plus />新建项目</Button></div></div><nav className="workspace-nav" aria-label="工作区"><Button variant="ghost" className={view==='assistant'?'selected-view':''} onClick={()=>setView('assistant')}><MessageSquareText/>创作与分析</Button><Button variant="ghost" className={view==='editor'?'selected-view':''} onClick={()=>setView('editor')}><PenLine/>编辑设定</Button></nav><div className="panel-heading"><span>设定目录</span><span className="tiny-count">{project.sections.length}</span></div><div className="outline-list">{project.sections.map(s => <button key={s.id} className={`outline-item ${selected === s.id ? 'active' : ''}`} onClick={() => {setSelected(s.id);setView('editor');}}><span>{s.label}{s.disabled && <small>已停用</small>}</span>{s.locked ? <LockKeyhole size={14}/> : selected === s.id ? <ChevronRight size={16}/> : null}</button>)}</div><Button variant="ghost" className="add-entry" onClick={addSection} disabled={busy}><Plus />添加世界书条目</Button><div className="outline-bottom"><span className="mini-label">本机项目</span><p>自动保存到当前浏览器。换设备前，请下载项目备份。</p><Button variant="outline" onClick={backup}><Download />项目备份</Button><Button variant="ghost" className="delete-project" onClick={() => requestProjectDeletion(project.id)} disabled={busy}><Trash2 />删除当前项目</Button><a href="/handoff.md" download><CircleHelp size={15}/>使用与交接文档<ArrowUpRight size={14}/></a></div></aside>
 {projectContext && <div className="project-context-backdrop" onClick={() => setProjectContext(null)} onContextMenu={event => { event.preventDefault(); setProjectContext(null); }}><div className="project-context-menu" role="menu" style={{ left: projectContext.x, top: projectContext.y }} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setProjectContext(null); }}><button autoFocus role="menuitem" onClick={() => requestProjectDeletion(projectContext.id)}><Trash2 size={15}/>删除「{projects.find(p => p.id === projectContext.id)?.name || '项目'}」</button></div></div>}
 <section className="editor-panel" hidden={view!=='editor'}><div className="document-head"><div className="document-eyebrow"><span className="accent-dash"/>人物档案<span>{project.source ? `读取自 ${project.source}` : '新建项目'}</span></div><Input aria-label="项目名称" className="document-title" value={project.name} disabled={busy} onChange={e => edit({ name: e.target.value })}/><div className="document-meta"><span>{count.toLocaleString()} 字符</span><span>{project.sections.filter(s => s.locked).length} 个模块已锁定</span><button onClick={() => { snapshot('手动保存'); toast.success('已保存版本快照'); }} disabled={busy}>保存快照</button></div></div>
 {section ? <div className="section-editor"><div className="section-title"><h1>{section.label}</h1><Button variant={section.locked ? 'secondary' : 'ghost'} onClick={() => editSection({ locked: !section.locked })} disabled={busy} aria-label={section.locked ? '解锁当前模块' : '锁定当前模块'}>{section.locked ? <LockKeyhole /> : <LockKeyholeOpen />}{section.locked ? '已锁定' : '锁定'}</Button></div>
 {section.keys && <div className="entry-settings"><Label htmlFor="entry-name">条目名称</Label><Input id="entry-name" value={section.label} disabled={section.locked || busy} onChange={e => editSection({ label: e.target.value })}/><Label htmlFor="entry-keys">触发词<span>用逗号分隔</span></Label><div className="trigger-input-row"><Input id="entry-keys" key={section.id + section.keys.join("|")} defaultValue={section.keys.join(', ')} disabled={section.locked || busy} onBlur={e => editSection({ keys: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}/><TriggerSuggestions key={project.id+section.id} section={section} busy={busy} onBusy={setBusy} onGenerate={requestModelText} onApply={(words,base)=>{if(section.locked||triggerBase(section)!==base){toast.error('条目已变化，请重新生成建议。');return;}snapshot('添加触发词前');const keys=[...(section.keys||[])];for(const word of words)if(!keys.some(k=>k.toLocaleLowerCase()===word.toLocaleLowerCase()))keys.push(word);editSection({keys});toast.success('已添加触发词');}}/></div><div className="check-row"><Label><Checkbox checked={!!section.constant} disabled={section.locked || busy} onCheckedChange={v => editSection({ constant: v === true })}/>常驻</Label><Label><Checkbox checked={!section.disabled} disabled={section.locked || busy} onCheckedChange={v => editSection({ disabled: v !== true })}/>启用条目</Label></div></div>}
 <Textarea aria-label={`${section.label}正文`} className="document-text" placeholder={'在这里写下人物的设定。\n\n也可以切换到“创作与分析”，让 AI 提出初稿。已有角色卡或世界书？点击顶部“读取文件”。'} value={section.text} disabled={section.locked || busy} onChange={e => editSection({ text: e.target.value })}/>
 <div className="editor-foot"><span>{section.text.length.toLocaleString()} 字符 · {section.locked ? '已保护，修改前请解锁' : '可直接编辑'}</span>{section.keys && <Button variant="ghost" disabled={busy || section.locked} onClick={() => setDeleteTarget('section')}><Trash2 />删除条目</Button>}</div></div> : <div className="empty-editor"><BookOpen /><p>这本世界书还没有条目。</p><Button onClick={addSection}><Plus />添加第一个条目</Button></div>}
 </section>
 <section className="assistant-panel" hidden={view!=='assistant'}><div className="assistant-heading"><span className="spark-icon"><Sparkles size={18}/></span><div><strong>创作助手</strong></div></div>
 <details className="preset-disclosure"><summary>创作预设<span>{project.creationPreset?.name||'均衡人物设定'}</span></summary><PresetPicker value={project.creationPreset} onChange={creationPreset=>edit({creationPreset})} disabled={busy}/></details>
 <Tabs value={panel} onValueChange={v=>{if(!busy)setPanel(v);}}><TabsList className="assistant-tabs"><TabsTrigger disabled={busy} value="create">创作</TabsTrigger><TabsTrigger disabled={busy} value="reference"><ScanText size={15}/>文本分析</TabsTrigger><TabsTrigger disabled={busy} value="feedback">游玩反馈</TabsTrigger><TabsTrigger disabled={busy} value="check">检查</TabsTrigger></TabsList>
 <TabsContent value="create"><div className="tool-form"><Label htmlFor="brief">你想要怎样的人物？</Label><Textarea id="brief" placeholder="身份、性格、经历、人物关系……一句话也可以开始。" rows={5} value={project.brief} disabled={busy} onChange={e => edit({ brief: e.target.value })}/><Label htmlFor="constraints">必须保留的设定</Label><Textarea id="constraints" placeholder="例如：保持慢热，不主动讲述过去。" rows={3} value={project.constraints} disabled={busy} onChange={e => edit({ constraints: e.target.value })}/><Label htmlFor="instruction">这次如何调整？<span>可选</span></Label><Textarea id="instruction" placeholder="例如：让当前模块的表达更含蓄。" rows={3} value={task.instruction} disabled={busy} onChange={e => setTask(t => ({ ...t, instruction: e.target.value }))}/><Button className="wide" disabled={busy} onClick={() => run('generate')}><Sparkles />生成人物设定</Button><Button className="wide" variant="outline" disabled={busy || !section || section.locked} onClick={() => run('rewrite')}>只修改当前模块</Button><button className="text-action" disabled={busy} onClick={() => openManual('generate')}><Copy size={14}/>复制提示词 / 粘贴结果</button><button className="text-action" disabled={busy || !section || section.locked} onClick={() => openManual('rewrite')}>手动修改当前模块</button></div></TabsContent>
 <TabsContent value="reference"><ReferenceStudy key={project.id} project={project} draft={referenceByProject[project.id]||blankReference()} onChange={draft=>setReferenceByProject(prev=>({...prev,[project.id]:draft}))} busy={busy} onBusy={setBusy} onGenerate={requestModelText} onReview={(proposal,base)=>{scopeRef.current=undefined;setReview({proposal,base,selected:proposal.patches.filter(p=>!project.sections.find(s=>s.id===p.id)?.locked).map(p=>p.id)});setModal('review');}}/></TabsContent>
 <TabsContent value="feedback"><div className="feedback-intro"><MessageSquareText size={20}/><p>把游玩时不对劲的地方告诉我，一起调整人物设定。</p></div><div className="tool-form"><Label htmlFor="actual">实际出现了什么问题？</Label><Textarea id="actual" rows={4} placeholder="例如：才认识两轮，他就开始倾诉秘密，和慢热的设定不符。" value={task.actual} disabled={busy} onChange={e => setTask(t => ({ ...t, actual: e.target.value }))}/><Label htmlFor="expected">你希望怎样表现？</Label><Textarea id="expected" rows={4} placeholder="例如：前期保持礼貌距离，通过小事逐步建立信任。" value={task.expected} disabled={busy} onChange={e => setTask(t => ({ ...t, expected: e.target.value }))}/><ChatEvidence key={project.id} value={chatByProject[project.id]} disabled={busy} onChange={value => setChatByProject(previous => ({ ...previous, [project.id]: value }))}/><Label htmlFor="excerpt">相关对话或运行信息<span>可选</span></Label><Textarea id="excerpt" rows={4} placeholder="粘贴出问题的对话，也可补充模型、预设或触发情况。" value={task.excerpt} disabled={busy} onChange={e => setTask(t => ({ ...t, excerpt: e.target.value }))}/><p className="muted-note">分析会参考全部设定与硬性要求；锁定模块不会被修改。</p><Button className="wide feedback-button" disabled={busy} onClick={() => run('feedback')}><MessageSquareText />分析并提出修订</Button><button className="text-action" disabled={busy} onClick={() => openManual('feedback')}><Copy size={14}/>复制反馈提示词 / 粘贴结果</button></div></TabsContent>
 <TabsContent value="check"><div className="tool-form"><div className="check-heading"><CheckCheck /><h2>导出前检查</h2></div><p className="muted-note">格式与触发词由程序检查；人物逻辑需要 AI 辅助判断。</p>{warnings.length ? <ul className="warning-list">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : <div className="check-ok">基础检查通过，可以导出。</div>}<Button className="wide" disabled={busy} onClick={() => run('check')}><Sparkles />检查人物逻辑</Button><button className="text-action" disabled={busy} onClick={() => openManual('check')}><Copy size={14}/>复制检查提示词 / 粘贴结果</button><p className="muted-note">建议可逐项接受。模型、上下文长度和外部提示词也可能影响角色表现。</p></div></TabsContent></Tabs>
 {busy && panel!=='reference' && <div className="generation-status" role="status"><span className="loading-line"/><p>正在分析与撰写建议…<small>完成后先展示差异，不自动覆盖正文。</small></p><Button variant="outline" onClick={() => abort.current?.abort()}><Square />停止</Button></div>}
 {review && !busy && modal !== 'review' && <Button variant="outline" className="wide review-return" onClick={() => setModal('review')}>返回尚未应用的建议</Button>}
 <div className="assistant-footer"><span className={`connection-mark ${connectionStatus?.fingerprint===configFingerprint(config,apiKey)&&connectionStatus.state==='success'?'connected':''}`}/>{connectionStatus?.fingerprint===configFingerprint(config,apiKey)&&connectionStatus.state==='success'?`最近请求成功 · ${config.model}`:apiKey?`配置已恢复 / 填写 · ${config.model} · 待验证`:'添加 API 即可生成，也支持手动粘贴'}</div></section>
 </main><footer className="page-footer"><span>自动保存到当前浏览器</span><span>SillyTavern 角色卡 / 世界书编辑器</span></footer>
 <Dialog open={modal === 'new'} onOpenChange={v => !v && setModal('')}><DialogContent><DialogHeader><DialogTitle>新建人物项目</DialogTitle><DialogDescription>选择编辑格式，导出时也可以转换为另一种格式。</DialogDescription></DialogHeader><div className="tool-form"><Label htmlFor="new-name">项目名称</Label><Input id="new-name" value={newName} placeholder="为你的人物取个名字" onChange={e => setNewName(e.target.value)}/><Tabs value={newKind} onValueChange={v => setNewKind(v as 'card' | 'world')}><TabsList className="wide"><TabsTrigger value="card"><FileText />角色卡</TabsTrigger><TabsTrigger value="world"><BookOpen />世界书</TabsTrigger></TabsList></Tabs><Button onClick={() => { const p = blank(newKind); p.name = newName.trim() || '未命名人物'; openProject(p); setNewName(''); }}>创建项目</Button></div></DialogContent></Dialog>
 <ApiSettings open={modal==='api'} onClose={()=>setModal('')} config={config} onChange={setConfig} apiKey={apiKey} onKeyChange={setAPIKey} onStatus={setConnectionStatus} onForget={()=>{setAPIKey('');const next={...config,rememberKey:false};setConfig(next);try{localStorage.setItem(CONFIG,JSON.stringify(configForStorage(next,'')));toast.success('已清除保存的密钥');}catch{toast.error('无法清除站点存储，请在浏览器中清理本站数据。');}}} onSave={()=>{try{const key=apiKey?normalizeKey(apiKey):'';localStorage.setItem(CONFIG,JSON.stringify(configForStorage(config,key)));setAPIKey(key);toast.success(config.rememberKey?'配置和密钥已保存在此浏览器':'配置已保存，密钥仅本次页面使用');setModal('');}catch(e){toast.error(err(e));}}}/>
 <Dialog open={modal === 'manual'} onOpenChange={v => !v && setModal('')}><DialogContent className="large-dialog"><DialogHeader><DialogTitle>在其他 AI 中生成</DialogTitle><DialogDescription>复制提示词到其他 AI，再粘贴完整 JSON 结果。应用前会展示修改差异。</DialogDescription></DialogHeader><div className="tool-form"><Label htmlFor="prompt">本次提示词</Label><Textarea id="prompt" readOnly value={promptText} rows={4}/><Button variant="outline" onClick={() => copy(promptText)}><Copy />复制完整提示词</Button><Label htmlFor="manual">AI 返回结果</Label><Textarea id="manual" value={manual} onChange={e => setManual(e.target.value)} rows={9} placeholder='粘贴包含 summary、warnings、additions、patches 的 JSON。也可将普通文字作为当前模块的替换建议。'/><div className="dialog-actions"><Button variant="outline" disabled={!section || section.locked || !manual.trim()} onClick={() => { setReview({ base: manualBase.current, selected: [selected], proposal: { summary: '手动文字替换', warnings: [], additions: ['此文字由你粘贴，未自动核验事实。'], patches: [{ id: selected, text: manual, reason: '将粘贴文字替换到当前模块' }] } }); setModal('review'); }}>作为当前模块文字</Button><Button disabled={!manual.trim()} onClick={() => { try {
        reviewText(manual, manualBase.current);
    }
    catch (e) {
        toast.error(err(e));
    } }}>解析并查看差异</Button></div></div></DialogContent></Dialog>
 <Dialog open={modal === 'review'} onOpenChange={v => !v && setModal('')}><DialogContent className="review-dialog"><DialogHeader><DialogTitle>审核修改建议</DialogTitle><DialogDescription>勾选要应用的修改。原版本会自动保留，锁定模块会跳过。</DialogDescription></DialogHeader>{review && <><div className="review-summary"><strong>{review.proposal.summary}</strong>{review.proposal.warnings.length > 0 && <ul>{review.proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}{review.proposal.additions.length > 0 && <div className="additions"><b>AI 补充 / 待确认</b><ul>{review.proposal.additions.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}</div><div className="patch-list">{!review.proposal.patches.length && <p>本次没有提出正文修改。</p>}{review.proposal.patches.map(patch => { const old = project.sections.find(s => s.id === patch.id); return <div className="patch" key={patch.id}><Label className="patch-title"><Checkbox checked={review.selected.includes(patch.id) && !old?.locked} disabled={old?.locked} onCheckedChange={v => setReview(r => r ? { ...r, selected: v === true ? [...r.selected, patch.id] : r.selected.filter(id => id !== patch.id) } : r)}/>{old?.label || patch.label}{old?.locked && <span>已锁定，将跳过</span>}</Label><p className="patch-reason">{patch.reason}</p><div className="diff-grid"><div><span className="diff-label">修改前</span><pre>{old?.text || '（空）'}</pre>{old?.keys && <small>触发词：{old.keys.join('、') || '无'} · {old.constant ? '常驻' : '按需触发'}</small>}</div><div><span className="diff-label">修改后</span><pre>{patch.text || '（空）'}</pre>{(patch.keys || patch.constant !== undefined) && <small>触发词：{(patch.keys || old?.keys || []).join('、') || '无'} · {(patch.constant ?? old?.constant) ? '常驻' : '按需触发'}</small>}</div></div></div>; })}</div><div className="dialog-actions"><Button variant="outline" onClick={() => setModal('')}>稍后处理</Button><Button disabled={!review.selected.length} onClick={applyReview}>应用所选修改（{review.selected.filter(id => !project.sections.find(s => s.id === id)?.locked).length}）</Button></div></>}</DialogContent></Dialog>
 <Dialog open={modal === 'history'} onOpenChange={v => !v && setModal('')}><DialogContent className="large-dialog"><DialogHeader><DialogTitle>版本记录</DialogTitle><DialogDescription>每个项目保留最近 20 个快照。恢复前会先保存当前状态。</DialogDescription></DialogHeader><Button variant="outline" onClick={() => { snapshot('手动保存'); toast.success('已保存快照'); }}>保存当前快照</Button><div className="history-list">{versions.length ? versions.map(v => <div className="history-row" key={v.id}><div><strong>{v.label}</strong><small>{new Date(v.time).toLocaleString('zh-CN')}</small></div><Button variant="outline" onClick={() => { snapshot('恢复版本前'); setProject({ ...structuredClone(v.project), id: project.id, updated: new Date().toISOString() }); setSelected(v.project.sections[0]?.id || ''); setReview(null); setModal(''); toast.success('已恢复选定版本'); }}><RotateCcw />恢复</Button></div>) : <p className="muted-note">还没有版本快照。应用 AI 修改时会自动保存。</p>}</div></DialogContent></Dialog>
 <Dialog open={modal === 'export'} onOpenChange={v => !v && setModal('')}><DialogContent className="large-dialog"><DialogHeader><DialogTitle>导出到 SillyTavern</DialogTitle><DialogDescription>导出 JSON 文件，在 SillyTavern 对应的角色卡或世界书页面导入。</DialogDescription></DialogHeader><Tabs value={exportKind} onValueChange={v => setExportKind(v as 'card' | 'world')}><TabsList className="wide"><TabsTrigger value="card"><FileText />角色卡 JSON</TabsTrigger><TabsTrigger value="world"><BookOpen />世界书 JSON</TabsTrigger></TabsList></Tabs>{exportKind !== project.kind && <div className="conversion-note">格式转换会重组正文：{exportKind === 'card' ? '条目正文汇入角色描述，并附上人物世界书。建议导入后补充开场白与示例对话。' : '各模块转为独立条目，默认以人物名触发；作者备注与高级提示指令不参与转换。'}原项目保持保留。</div>}{warnings.length > 0 && <p className="muted-note">当前有 {warnings.length} 条基础检查提示，可在“检查”中查看。</p>}<pre className="json-preview">{JSON.stringify(exportData, null, 2)}</pre><div className="dialog-actions"><Button variant="outline" onClick={backup}>下载项目备份</Button><Button disabled={!project.sections.some(s => s.text.trim())} onClick={() => download(`${project.name}.${exportKind === 'card' ? 'character' : 'worldinfo'}.json`, exportData)}><Download />下载 JSON</Button></div><p className="muted-note">同格式导出保留原有扩展字段；PNG 读取后导出为 JSON，不包含原图片。项目备份额外保留要求、锁定状态与版本记录。</p></DialogContent></Dialog>
 <AlertDialog open={deleteTarget !== null} onOpenChange={v => { if (!v) { setDeleteTarget(null); setProjectToDelete(null); } }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget === 'project' ? `删除「${projects.find(p => p.id === projectToDelete)?.name || project.name}」？` : '删除当前条目？'}</AlertDialogTitle><AlertDialogDescription>{deleteTarget === 'project' ? '项目与本机版本记录会一起删除。需要保留时，请先下载项目备份。' : '删除前会保存版本快照，可从版本记录恢复。'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { if (deleteTarget === 'section') {
        snapshot('删除条目前');
        const list = project.sections.filter(s => s.id !== selected);
        edit({ sections: list });
        setSelected(list[0]?.id || '');
    }
    else {
        const id = projectToDelete || project.id;
        setReferenceByProject(previous=>{const next={...previous};delete next[id];return next;});
        setChatByProject(previous=>{const next={...previous};delete next[id];return next;});
        let list = projects.filter(p => p.id !== id);
        if (!list.length)
            list = [blank()];
        setProjects(list);
        if (id === project.id) {
            setProject(list[0]);
            setSelected(list[0].sections[0]?.id || '');
            setTask(initialTask);
            setReview(null);
        }
        setHistories(h => { const next = { ...h }; delete next[id]; return next; });
    } setProjectToDelete(null); setDeleteTarget(null); }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </div>;
}
