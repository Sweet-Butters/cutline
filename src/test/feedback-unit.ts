import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {Timeline,writeTimeline} from '../core';
import {run} from '../media';
import {captureAnchor,resolveAnchor,timelineId} from '../feedback-anchor';
import {FeedbackStore,FeedbackConflict,FeedbackLocationError,FEEDBACK_STATUSES,FeedbackMutation} from '../feedback';
import {sequenceModel} from '../sequence';
const hashes={'sources/a.mp4':'a'.repeat(64),'sources/b.mp4':'b'.repeat(64),'sources/renamed.mp4':'a'.repeat(64)};
const v1=():Timeline=>({version:1,clips:[{id:'intro',source:'sources/b.mp4',in:0,out:70},{id:'scene',source:'sources/a.mp4',in:100,out:140}]});
const v2=():Timeline=>({version:1,clips:[{id:'intro',source:'sources/b.mp4',in:0,out:25},{id:'scene',source:'sources/a.mp4',in:100,out:140}]});
test('feedback point at V1 01:20 reconnects to V2 00:35 using clip and source time',()=>{
  const a=captureAnchor(v1(),80,undefined,hashes);assert.equal(a.spans[0].sourceStart,110);
  const mapped=resolveAnchor(a,v2(),hashes);assert.equal(mapped.state,'linked');if(mapped.state==='linked'){assert.equal(mapped.start,35);assert.equal(mapped.method,'clip-and-source');}
  const reordered=v2();reordered.clips.reverse();const r=resolveAnchor(a,reordered,hashes);assert.equal(r.state,'linked');if(r.state==='linked')assert.equal(r.start,10);
});
test('feedback survives source renames and clip splits without timeline-nearest guesses',()=>{
  const a=captureAnchor(v1(),80,undefined,hashes),split=v2();split.clips.splice(1,1,{id:'scene',source:'sources/a.mp4',in:100,out:108},{id:'right',source:'sources/a.mp4',in:108,out:140});
  let r=resolveAnchor(a,split,hashes);assert.equal(r.state,'linked');if(r.state==='linked'){assert.equal(r.start,35);assert.equal(r.method,'source-time');}
  const renamed=v2();renamed.clips[1].source='sources/renamed.mp4';r=resolveAnchor(a,renamed,hashes);assert.equal(r.state,'linked');if(r.state==='linked')assert.equal(r.start,35);
});
test('duplicate, deleted, trimmed and replaced footage blocks navigation',()=>{
  const a=captureAnchor(v1(),80,undefined,hashes),duplicate=v2();duplicate.clips[1].id='copy-a';duplicate.clips.push({...duplicate.clips[1],id:'copy-b'});
  let r=resolveAnchor(a,duplicate,hashes);assert.equal(r.state,'needs_review');if(r.state==='needs_review')assert.equal(r.reason,'ambiguous');
  const trimmed=v2();trimmed.clips[1].in=112;assert.equal(resolveAnchor(a,trimmed,hashes).state,'needs_review');
  const removed=v2();removed.clips.pop();assert.equal(resolveAnchor(a,removed,hashes).state,'needs_review');
  assert.equal(resolveAnchor(a,v2(),{...hashes,'sources/a.mp4':'c'.repeat(64)}).state,'needs_review');
  const withIdentity=v2();withIdentity.clips.push({...withIdentity.clips[1],id:'repeat'});r=resolveAnchor(a,withIdentity,hashes);assert.equal(r.state,'linked');if(r.state==='linked')assert.equal(r.start,35);
});
test('feedback ranges span split clips but reject missing, reordered or ambiguous fragments',()=>{
  const a=captureAnchor(v1(),78,90,hashes),split=v2();split.clips.splice(1,1,{id:'left',source:'sources/a.mp4',in:100,out:112},{id:'right',source:'sources/a.mp4',in:112,out:140});
  const r=resolveAnchor(a,split,hashes);assert.equal(r.state,'linked');if(r.state==='linked'){assert.equal(r.start,33);assert.equal(r.end,45);assert.equal(r.segments.length,2);}
  const reverse=v2();reverse.clips=[{id:'right',source:'sources/a.mp4',in:112,out:140},{id:'left',source:'sources/a.mp4',in:100,out:112}];assert.equal(resolveAnchor(a,reverse,hashes).state,'needs_review');
  const partial:Timeline={version:1,clips:[{id:'one',source:'sources/a.mp4',in:108,out:120},{id:'two',source:'sources/a.mp4',in:112,out:120}]};const unresolved=resolveAnchor(a,partial,hashes);assert.equal(unresolved.state,'needs_review');if(unresolved.state==='needs_review')assert.equal(unresolved.reason,'ambiguous');
});
test('source-less gaps are version-specific and overlapping layers require explicit targeting',()=>{
  let seq=sequenceModel.fromTimeline(v1());seq=sequenceModel.operate(seq,{action:'move',ids:['scene'],linked:true,delta:5});const gap=sequenceModel.toTimeline(v1(),seq);
  const a=captureAnchor(gap,72,undefined,hashes);assert.equal(a.versionOnly,true);assert.equal(resolveAnchor(a,gap,hashes).state,'linked');assert.equal(resolveAnchor(a,v2(),hashes).state,'needs_review');
  const layers=sequenceModel.operate(sequenceModel.fromTimeline(v2()),{action:'insert',item:{id:'overlap',kind:'video',source:'sources/b.mp4',trackId:'V2',start:30,in:0,out:10}}),t=sequenceModel.toTimeline(v2(),layers);
  assert.throws(()=>captureAnchor(t,35,undefined,hashes),/대상 클립/);assert.equal(captureAnchor(t,35,undefined,hashes,'scene').spans[0].sourceStart,110);
  assert.throws(()=>captureAnchor(v1(),110,undefined,hashes),/끝 경계/);assert.equal(captureAnchor(v1(),70,undefined,hashes).spans[0].clipId,'scene');
});
async function fixture(){const root=path.resolve(__dirname,'../..','.test-data');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'feedback-'));await fs.mkdir(path.join(dir,'sources'));await fs.writeFile(path.join(dir,'sources/a.mp4'),'source-a');await fs.writeFile(path.join(dir,'sources/b.mp4'),'source-b');await writeTimeline(dir,v1());return dir;}
const input=(state:{revision:number},action:FeedbackMutation['action'],extra:Partial<FeedbackMutation>={}):FeedbackMutation=>({action,requestId:crypto.randomUUID(),expectedRevision:state.revision,...extra});
test('feedback persists threaded replies, author snapshots and all six status histories after restart',async()=>{
  const dir=await fixture(),store=new FeedbackStore(dir);let view=await store.view(v1());
  view=await store.mutate(input(view,'profile',{name:'검토자',role:'편집 제안자'}),v1());
  const create=input(view,'create',{body:'여기 반응을 더 살려 주세요',status:'수정 요청',start:80,versionId:timelineId(v1())});view=await store.mutate(create,v1());const threadId=view.threads[0].id;
  await store.mutate(create,v1());assert.equal((await store.view(v1())).threads.length,1,'duplicate request is idempotent');
  view=await store.mutate(input(view,'profile',{name:'편집 담당',role:'편집자'}),v1());assert.equal(view.threads[0].author.name,'검토자');
  view=await store.mutate(input(view,'reply',{threadId,body:'수정하겠습니다'}),v1());const parentId=view.threads[0].replies[0].id;
  view=await store.mutate(input(view,'reply',{threadId,parentId,body:'음악도 함께 확인했습니다'}),v1());
  for(const next of FEEDBACK_STATUSES.slice(1))view=await store.mutate(input(view,'status',{threadId,status:next}),v1());
  const restarted=new FeedbackStore(dir),after=await restarted.view(v2());assert.equal(after.threads[0].replies[1].parentId,parentId);assert.equal(after.threads[0].status,'검토 완료');assert.equal(after.threads[0].events.filter(e=>e.type==='status').length,5);assert.equal(after.threads[0].resolution.state,'linked');
  const nav=await restarted.navigation(threadId,v2());assert.equal(nav.resolution.start,35);const original=await restarted.snapshot(await restarted.originalVersion(threadId));assert.equal((await restarted.navigation(threadId,original,true)).resolution.start,80);
});
test('manual relink preserves original context and is the only way through ambiguity',async()=>{
  const dir=await fixture(),store=new FeedbackStore(dir);let view=await store.view(v1());view=await store.mutate(input(view,'create',{body:'장면 확인',status:'수정 요청',start:80,versionId:timelineId(v1())}),v1());const threadId=view.threads[0].id;
  const dup=v2();dup.clips[1].id='copy-one';dup.clips.push({...dup.clips[1],id:'copy-two'});view=await store.view(dup);
  await assert.rejects(store.navigation(threadId,dup),FeedbackLocationError);
  view=await store.mutate(input(view,'relink',{threadId,start:75,clipId:'copy-two',versionId:timelineId(dup),note:'두 번째 반복 장면으로 확인'}),dup);
  assert.equal(view.threads[0].anchors.length,2);assert.equal(view.threads[0].anchors[0].anchor.start,80);assert.equal((await store.navigation(threadId,dup)).resolution.start,75);assert.equal((await store.navigation(threadId,v1(),true)).resolution.start,80);
});
test('concurrent windows detect stale writes instead of dropping a comment',async()=>{
  const dir=await fixture(),a=new FeedbackStore(dir),b=new FeedbackStore(dir);const before=await a.view(v1());
  const make=(body:string)=>input(before,'create',{body,status:'수정 요청',start:80,versionId:timelineId(v1())});
  const results=await Promise.allSettled([a.mutate(make('첫 창'),v1()),b.mutate(make('두 번째 창'),v1())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.ok(rejected.reason instanceof FeedbackConflict);assert.equal((await a.view(v1())).threads.length,1);
});
test('snapshots link only to Git commits with matching timeline contents; corruption is preserved',async()=>{
  const dir=await fixture();await run('git',['init'],dir);await run('git',['config','user.name','테스트'],dir);await run('git',['config','user.email','test@example.invalid'],dir);await run('git',['config','commit.gpgsign','false'],dir);await run('git',['add','timeline.json'],dir);await run('git',['commit','-m','첫 편집 기록'],dir);
  const store=new FeedbackStore(dir);let view=await store.view(v1());assert.equal(view.viewVersion.git.length,1);const first=view.viewVersion.git[0].hash;
  await writeTimeline(dir,v2());view=await store.view(v2());assert.equal(view.viewVersion.git.length,0,'dirty work is not labeled as HEAD');await run('git',['add','timeline.json'],dir);await run('git',['commit','-m','장면을 앞으로 옮긴 편집'],dir);view=await store.view(v2());assert.equal(view.viewVersion.git.length,1);assert.notEqual(view.viewVersion.git[0].hash,first);
  const file=path.join(store.directory,'state.json');await fs.writeFile(file,'{"broken":');await assert.rejects(new FeedbackStore(dir).view(v1()),/기존 파일/);assert.equal(await fs.readFile(file,'utf8'),'{"broken":');
});
