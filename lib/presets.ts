export type CreationPreset={id:string;name:string;text:string};
export const CREATION_PRESETS:CreationPreset[]=[
 {id:'balanced',name:'均衡人物设定',text:'优先形成完整、可演绎的人物。把性格落实为具体行为，保留人物的复杂性，避免标签堆砌和重复套话。'},
 {id:'consistency',name:'人物一致性',text:'优先核对身份、动机、人物关系与信任进程。变化应有可观察的触发条件；不要把一次情绪波动写成永久性格变化。'},
 {id:'literary',name:'含蓄文学表达',text:'表达自然克制，用言语、动作和具体选择表现感情，减少直接解释人物内心。保持设定清楚可用，不用华丽辞藻代替行为规则。'},
 {id:'minimal',name:'最小修订',text:'仅修改与用户反馈直接相关的设定。保留原文有效信息与文风，说明每项修改对应的问题，不扩写无关剧情或新增关系。'},
];
export function importPreset(source:string,filename:string):CreationPreset{
 let name=filename.replace(/\.[^.]+$/,''),text=source.trim();
 if(/\.json$/i.test(filename)){
   let data;try{data=JSON.parse(source);}catch{throw Error('预设 JSON 无法解析。');}
   if(!data||typeof data!=='object')throw Error('预设需要包含 name 和 text 字段。');
   name=typeof data.name==='string'?data.name:name;
   text=typeof data.text==='string'?data.text:typeof data.prompt==='string'?data.prompt:'';
 }
 if(!text||text.length>20000)throw Error('预设内容需为 1–20000 字符。JSON 支持 name、text（或 prompt）字段。');
 return {id:'custom',name:name||'自定义创作预设/破甲预设',text};
}
