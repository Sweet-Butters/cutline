import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {evaluate,Inputs,parseSettings,summary,hash,checkProject} from '../check';
import {Timeline} from '../core';
import {exportTimeline} from '../media';
const timeline=():Timeline=>({version:1,clips:[{id:'a',source:'sources/a.mp4',in:0,out:10},{id:'b',source:'sources/a.mp4',in:10,out:20}]});
const input=():Inputs=>({durations:{'sources/a.mp4':40},transcript:{'sources/a.mp4':[{start:0,end:10,text:'핵심 hello'},{start:10,end:20,text:'끝'}]},spec:{targetDuration:[20,20],minClipLength:1,maxClipLength:10,requiredKeywords:['핵심'],forbiddenKeywords:['광고']},style:{clipLengthMedian:[10,10],clipLengthIQR:[8,12],keepRatio:[.5,.5]}});
const result=(id:string,t=timeline(),i=input())=>evaluate(t,i).find(r=>r.id===id)!;
test('bounds pass, overrun and missing source fail with locations',()=>{
  assert.equal(result('source-bounds').status,'PASS');const t=timeline();t.clips[1].out=41;
  assert.equal(result('source-bounds',t).status,'FAIL');assert.equal(result('source-bounds',t).offending[0].clipId,'b');
  const i=input();delete i.durations['sources/a.mp4'];assert.equal(result('source-bounds',timeline(),i).status,'FAIL');
});
test('duplicate seconds use union: exactly 50% pass, over 50% warn, disjoint/different sources pass',()=>{
  const t=timeline();t.clips=[t.clips[0],{...t.clips[0],id:'repeat'}];assert.equal(result('duplicate-spans',t).status,'PASS');
  t.clips.push({...t.clips[0],id:'third'});assert.equal(result('duplicate-spans',t).status,'WARN');
  assert.equal((result('duplicate-spans',t).actual as any).seconds,20);
  t.clips[1].source='sources/b.mp4';t.clips.pop();assert.equal(result('duplicate-spans',t).status,'PASS');
});
test('duration inclusive endpoints, FAIL, absent, style fallback and spec precedence',()=>{
  assert.equal(result('duration').status,'PASS');const i=input();i.spec!.targetDuration=[1,19];assert.equal(result('duration',timeline(),i).status,'FAIL');
  delete i.spec!.targetDuration;assert.equal(result('duration',timeline(),i).status,'미평가');i.style!.targetDuration=[20,20];assert.equal(result('duration',timeline(),i).status,'PASS');i.spec!.targetDuration=[1,19];assert.equal(result('duration',timeline(),i).status,'FAIL');
});
test('clip length limits pass/fail/unevaluated',()=>{
  assert.equal(result('clip-length').status,'PASS');const i=input();i.spec!.maxClipLength=9;assert.equal(result('clip-length',timeline(),i).status,'FAIL');i.spec={minClipLength:11};assert.equal(result('clip-length',timeline(),i).status,'FAIL');i.spec={};assert.equal(result('clip-length',timeline(),i).status,'미평가');
});
test('distribution median and out-of-IQR share independently warn; absent/empty unevaluated',()=>{
  assert.equal(result('clip-distribution').status,'PASS');const i=input();i.style!.clipLengthMedian=[1,9];assert.equal(result('clip-distribution',timeline(),i).status,'WARN');i.style!.clipLengthMedian=[10,10];i.style!.clipLengthIQR=[1,9];assert.equal(result('clip-distribution',timeline(),i).status,'WARN');i.style={};assert.equal(result('clip-distribution',timeline(),i).status,'미평가');assert.equal(result('clip-distribution',{version:1,clips:[]}).status,'미평가');
});
test('transcript cuts warn only more than .5 seconds inside; missing transcript unevaluated',()=>{
  assert.equal(result('transcript-cuts').status,'PASS');const t=timeline();t.clips[0].in=.5;assert.equal(result('transcript-cuts',t).status,'PASS');t.clips[0].in=.501;const r=result('transcript-cuts',t);assert.equal(r.status,'WARN');assert.equal(r.offending[0].start,.501);const i=input();i.transcript={};assert.equal(result('transcript-cuts',t,i).status,'미평가');i.transcript={'sources/a.mp4':[]};assert.equal(result('transcript-cuts',t,i).status,'미평가');
});
test('keep ratio uses unique seconds over all project sources; missing/invalid data unevaluated',()=>{
  assert.equal(result('keep-ratio').status,'PASS');const t=timeline();t.clips.push({...t.clips[0],id:'again'});assert.equal(result('keep-ratio',t).status,'PASS');const i=input();i.durations['sources/unused.mp4']=40;assert.equal(result('keep-ratio',t,i).status,'WARN');i.style={};assert.equal(result('keep-ratio',t,i).status,'미평가');i.style={keepRatio:[0,1]};i.durations['sources/a.mp4']=NaN;assert.equal(result('keep-ratio',t,i).status,'미평가');
});
test('keywords inspect retained transcript only and require complete evidence',()=>{
  for(const id of ['requiredKeywords','forbiddenKeywords'])assert.equal(result(id).status,'PASS');const i=input();i.spec!.requiredKeywords=['missing'];i.spec!.forbiddenKeywords=['HELLO'];assert.equal(result('requiredKeywords',timeline(),i).status,'FAIL');assert.equal(result('forbiddenKeywords',timeline(),i).offending[0].clipId,'a');const t=timeline();t.clips.shift();assert.equal(result('forbiddenKeywords',t,i).status,'PASS');i.transcript={};assert.equal(result('requiredKeywords',t,i).status,'미평가');i.spec={};assert.equal(result('forbiddenKeywords',t,i).status,'미평가');
});
test('human rule is always unevaluated and never counted as passed',()=>{
  const r=result('creative-review');assert.equal(r.status,'미평가');assert.match(r.message,/창작자 확인 필요/);assert.equal(summary([r]),'검증 0/0 통과 · 경고 0 · 실패 0 · 미평가 1');assert.match(summary(evaluate(timeline(),input())),/8\/9 통과 · 경고 1|9\/9 통과/);
});
test('malformed specs are explicit errors, never silently passes',()=>{
  for(const s of ['null','{"targetDuration":[4,1]}','{"keepRatio":[0,2]}','{"typo":4}','{"maxClipLength":-1}','{"requiredKeywords":[""]}'])assert.throws(()=>parseSettings(s,'spec'));
  assert.throws(()=>parseSettings('{"keepRatio":[0,2]}','style'));
  assert.equal(evaluate(timeline(),{...input(),errors:{spec:'invalid'}}).find(r=>r.id==='spec-input')!.status,'FAIL');
});
test('real export gate, report identity, version hashes and CLI parity',async()=>{
  const root=path.resolve(__dirname,'../..'),base=path.join(root,'.test-data');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'check-'));
  await fs.mkdir(path.join(dir,'sources'));await fs.copyFile(path.join(root,'sample-project/sources/camera-1.mp4'),path.join(dir,'sources/a.mp4'));
  const t:Timeline={version:1,clips:[{id:'a',source:'sources/a.mp4',in:0,out:1}]};
  const spec='{"version":"test-v1","targetDuration":[2,3]}';await fs.writeFile(path.join(dir,'edit-spec.json'),spec);
  await assert.rejects(exportTimeline(dir,t),/hard FAIL/);let prompted=false;await assert.rejects(exportTimeline(dir,t,async r=>{prompted=true;assert.match(r.summary,/실패 1/);return false;}),/hard FAIL/);assert.ok(prompted);
  const output=await exportTimeline(dir,t,async()=>true),report=JSON.parse(await fs.readFile(output.replace(/\.mp4$/,'.report.json'),'utf8'));
  assert.equal(report.timelineHash,hash(JSON.stringify(t)));assert.equal(report.versions.spec.sha256,hash(spec));assert.equal(report.versions.spec.version,'test-v1');assert.equal(report.hardFailOverride,true);assert.deepEqual(report.results,(await checkProject(dir,t)).results);
  await fs.writeFile(path.join(dir,'timeline.json'),JSON.stringify(t));
  const cli=spawnSync(process.execPath,[path.join(root,'tools/vidcli.js'),'--project',dir,'check','--json'],{encoding:'utf8',windowsHide:true});assert.equal(cli.status,1);assert.deepEqual(JSON.parse(cli.stdout).results,report.results);
  await fs.writeFile(path.join(dir,'edit-spec.json'),'{broken');assert.equal((await checkProject(dir,t)).results.find(r=>r.id==='spec-input')!.status,'FAIL');
  await fs.writeFile(path.join(dir,'style.md'),'```cutline-style\n{"keepRatio":[0,2]}\n```');assert.equal((await checkProject(dir,t)).results.find(r=>r.id==='style-input')!.status,'WARN');
});
