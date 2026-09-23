import test from 'node:test';
import assert from 'node:assert/strict';
import {blankReference,studyPrompt,parseStudy,adaptationTask,MAX_REFERENCE_CHARS} from '../lib/reference.ts';
import {blank,makePrompt,parseProposal,applyPatches} from '../lib/project.ts';
const source='林照放慢脚步，等陈望跟上。\n\n陈望没有追问，只递给他一杯水。';
const result={summary:'克制的关心。',characters:[{name:'林照',portrait:'通过行动表达关心。',motivation:'照顾对方',speech:'少言',behavior:'放慢步伐',evidence:[{paragraph:1,quote:'放慢脚步'}]}],relationships:[{people:['林照','陈望'],kind:'日常交流',dynamic:'互相照顾但不过度追问',progression:'信任逐步建立',interaction:'以行动代替追问',evidence:[{paragraph:2,quote:'没有追问'}]}],warnings:[]};
test('Study prompt scopes direction and sends source only once, excluding unrelated draft data',()=>{
 const draft={...blankReference(),source,focus:'林照与陈望',relationshipKind:'日常交流',requirements:'关注边界',raw:'unrelated old result',mapping:'not-analysis-input'};
 const prompt=studyPrompt(source,draft);assert.match(prompt,/关注边界/);assert.match(prompt,/日常交流/);assert.equal(prompt.split('林照放慢脚步').length-1,1);assert.doesNotMatch(prompt,/unrelated old result|not-analysis-input/);assert.throws(()=>studyPrompt(' ',draft),/先粘贴/);assert.throws(()=>studyPrompt('x'.repeat(MAX_REFERENCE_CHARS+1),draft),/单次分析最多/);
});
test('Evidence is verified against exact numbered source paragraphs and hallucinations are marked',()=>{
 const report=parseStudy(JSON.stringify(result),source,'both');assert.equal(report.characters[0].evidence[0].verified,true);assert.equal(report.relationships[0].evidence[0].verified,true);
 const changed=structuredClone(result);changed.characters[0].evidence[0]={paragraph:2,quote:'放慢脚步'};const ungrounded=parseStudy(JSON.stringify(changed),source,'both');assert.equal(ungrounded.characters[0].evidence[0].verified,false);assert.ok(ungrounded.warnings.some(w=>w.includes('可核对')));
});
test('Requested analysis modes exclude unwanted findings and reject unusable output',()=>{
 assert.equal(parseStudy(JSON.stringify(result),source,'characters').relationships.length,0);assert.equal(parseStudy(JSON.stringify(result),source,'relationships').characters.length,0);
 assert.throws(()=>parseStudy('invalid',source,'both'),/JSON/);assert.throws(()=>parseStudy('{"summary":"空","characters":[],"relationships":[]}',source,'both'),/没有得到/);
});
test('Adaptation includes only selected findings and the user mapping, without source text or unselected portraits',()=>{
 const p=blank('world'),draft={...blankReference(),source,report:parseStudy(JSON.stringify(result),source,'both'),mapping:'林照对应陆川，陈望对应周宁；保留现有经历',selected:['relationship:0']};
 const t=adaptationTask(p,draft);assert.equal(t.referenceAdaptation.characters.length,0);assert.equal(t.referenceAdaptation.relationships.length,1);const prompt=makePrompt(p,t);assert.match(prompt,/林照对应陆川/);assert.doesNotMatch(prompt,/林照放慢脚步|通过行动表达关心/);assert.match(prompt,/不照搬原文姓名/);
 assert.throws(()=>adaptationTask(p,{...draft,selected:[]}),/至少选择/);assert.throws(()=>adaptationTask(p,{...draft,mapping:''}),/对应谁/);
});
test('Adaptation proposals retain the existing lock and extension-field protections',()=>{
 const p=blank('world');p.sections=[{id:'entry:1',label:'身份',text:'既有身份',locked:true,keys:['陆川'],raw:{depth:7}},{id:'entry:2',label:'相处',text:'旧相处方式',locked:false,keys:['周宁'],raw:{depth:4}}];
 const proposal=parseProposal(JSON.stringify({summary:'调整',patches:[{id:'entry:1',text:'不应覆盖',reason:'test'},{id:'entry:2',text:'尊重边界',reason:'按映射'}]}),p);
 const next=applyPatches(p,proposal.patches);assert.equal(next.sections[0].text,'既有身份');assert.equal(next.sections[1].text,'尊重边界');assert.equal(next.sections[1].raw.depth,4);assert.equal(p.sections[1].text,'旧相处方式');
});
