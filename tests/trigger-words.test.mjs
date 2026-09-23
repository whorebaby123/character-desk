import test from 'node:test';
import assert from 'node:assert/strict';
import {triggerPrompt,parseTriggerWords,triggerBase} from '../lib/trigger-words.ts';
test('Trigger suggestions discard duplicate, existing, malformed and regex keys',()=>{
 const raw=JSON.stringify({suggestions:[{word:'林照',reason:'已有'},{word:' Night ',reason:'名称'},{word:'night',reason:'重复'},{word:'/林.*/i',reason:'正则'},{word:'茶馆，竹林',reason:'多个词'},{word:'旧茶馆',reason:'特定地点'},null]});
 assert.deepEqual(parseTriggerWords(raw,['林照']),[{word:'Night',reason:'名称'},{word:'旧茶馆',reason:'特定地点'}]);
 assert.throws(()=>parseTriggerWords('invalid',[]),/JSON/);
 assert.deepEqual(parseTriggerWords('{"suggestions":[]}',[]),[]);
});
test('Suggestion source excludes extensions and guards content changes',()=>{
 const s={id:'entry:1',label:'旧茶馆',text:'林照住在旧茶馆。',keys:['林照'],locked:false,raw:{unrelated:'secret-extension'}};
 const prompt=triggerPrompt(s);assert.match(prompt,/旧茶馆/);assert.doesNotMatch(prompt,/secret-extension/);
 assert.notEqual(triggerBase(s),triggerBase({...s,text:'新的正文'}));
 assert.notEqual(triggerBase(s),triggerBase({...s,locked:true}));
 assert.throws(()=>triggerPrompt({...s,text:''}),/正文/);
});
