/** Chat evidence is ephemeral and separate from character/worldbook data. */
export type ChatMessage = { id: number; name: string; role: 'user' | 'assistant' | 'system' | 'unknown'; text: string; date?: string };
export type ChatLog = { filename: string; messages: ChatMessage[]; notices: string[] };
export type ChatAttachment = { log: ChatLog; selected: number[]; enabled: boolean };
export const MAX_CHAT_CHARS = 40000;
const record = (x: unknown): Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const roleNames = { user: '用户', assistant: '角色', system: '系统', unknown: '未标注角色' };
export function parseChat(source: string, filename: string): ChatLog {
  const text = source.replace(/^\uFEFF/, '').trim();
  if (!text) throw Error('对话文件为空。');
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw Error('对话文件不能超过 10 MB。');
  const notices: string[] = [];
  let rows: unknown[];
  if (/\.(txt|md)$/i.test(filename)) {
    notices.push('纯文字按空行分段；说话者未自动推断。建议优先导入酒馆 JSONL 导出。');
    rows = text.split(/\n\s*\n/).filter(Boolean).map(content => ({ content }));
  } else {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { /* JSONL is expected to contain multiple JSON values. */ }
    if (parsed !== undefined) {
      const object = record(parsed);
      if (Array.isArray(parsed)) rows = parsed;
      else if (Array.isArray(object.messages)) rows = object.messages;
      else if (Array.isArray(object.chat)) rows = object.chat;
      else if (typeof object.mes === 'string') rows = [object];
      else throw Error('这不是可识别的对话文件。角色卡和世界书请使用顶部“读取文件”。');
    } else {
      rows = text.split(/\r?\n/).flatMap((line, index) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line)]; }
        catch { throw Error(`第 ${index + 1} 行不是有效 JSON，未导入任何消息。`); }
      });
    }
  }
  let skipped = 0, swipes = 0;
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    const r = record(row);
    // Never import headers, reasoning, swipe alternatives or metadata as messages.
    if (r.chat_metadata !== undefined && r.mes === undefined && r.content === undefined) continue;
    if (r.user_name !== undefined && r.character_name !== undefined && r.mes === undefined) continue;
    const body = typeof r.mes === 'string' ? r.mes : typeof r.content === 'string' ? r.content : '';
    if (!body.trim()) { skipped++; continue; }
    const role: ChatMessage['role'] = r.is_system === true || r.role === 'system' ? 'system' : r.is_user === true || r.role === 'user' ? 'user' : r.is_user === false || r.role === 'assistant' ? 'assistant' : 'unknown';
    if (Array.isArray(r.swipes) && r.swipes.length > 1) swipes++;
    messages.push({ id: messages.length + 1, role, name: typeof r.name === 'string' && r.name ? r.name : roleNames[role], text: body, ...(typeof r.send_date === 'string' ? {date:r.send_date} : {}) });
    if (messages.length > 10000) throw Error('一次最多读取 10000 条消息，请拆分对话后导入。');
  }
  if (!messages.length) throw Error('未发现可读取的对话正文（mes / content）。');
  if (skipped) notices.push(`已跳过 ${skipped} 条空白或没有文字正文的记录。`);
  if (swipes) notices.push(`${swipes} 条消息有多个候选回复，仅读取导出文件中的当前正文 mes。`);
  return { filename, messages, notices };
}
export function latestSelection(log: ChatLog): number[] {
  const latest = log.messages.filter(m => m.role !== 'system').slice(-20);
  const chosen: number[] = [];
  let length = 0;
  for (const m of [...latest].reverse()) {
    const size = formatMessage(m).length + 2;
    if (size + length > MAX_CHAT_CHARS) break;
    chosen.unshift(m.id); length += size;
  }
  return chosen;
}
function formatMessage(m: ChatMessage): string {
  return `【消息 #${m.id}｜${roleNames[m.role]}｜${m.name}】\n${m.text}`;
}
export function selectedMessages(attachment: ChatAttachment): ChatMessage[] {
  const selected = new Set(attachment.selected);
  return attachment.log.messages.filter(m => selected.has(m.id));
}
export function evidenceText(attachment?: ChatAttachment): string {
  if (!attachment?.enabled) return '';
  return selectedMessages(attachment).map(formatMessage).join('\n\n');
}
export function feedbackEvidence(attachment?: ChatAttachment): { filename: string; excerpt: string } | undefined {
  if (!attachment?.enabled) return undefined;
  const excerpt = evidenceText(attachment);
  if (!excerpt) throw Error('对话辅助已开启，但未选中消息。请选择消息，或关闭对话辅助。');
  if (excerpt.length > MAX_CHAT_CHARS) throw Error(`所选对话超过 ${MAX_CHAT_CHARS.toLocaleString()} 字符，请缩小消息范围。`);
  return { filename: attachment.log.filename, excerpt };
}
