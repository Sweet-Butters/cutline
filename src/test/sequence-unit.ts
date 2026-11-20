import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {sequenceModel as M,Sequence} from '../sequence';
import {Timeline,validate,readTimeline,writeTimeline,duration,edit} from '../core';
import {manualEdit,EditSession} from '../editing';
import {validateMedia,run,exportTimeline} from '../media';
const model=require('../../media/sequence-model');
const base=():Timeline=>({version:1,clips:[{id:'first',source:'sources/a.mp4',in:2,out:4},{id:'second',source:'sources/a.mp4',in:6,out:8}]});
const sequence=()=>M.fromTimeline(base());
test('sequence adapts existing edits deterministically without modifying the legacy timeline',()=>{
  const t=base(),before=structuredClone(t),a=sequence(),b=sequence();assert.deepEqual(a,b);assert.deepEqual(t,before);
  assert.equal(a.items.length,4);assert.equal(M.duration(a),4);assert.equal(a.tracks.length,7);
  const next=M.toTimeline(t,a);assert.deepEqual(next.clips,t.clips);assert.deepEqual(M.fromTimeline(next),a);
  const agent=edit(next,'trim',['first','2','3']);assert.equal(agent.sequence!.items.find(c=>c.id==='second')!.start,1);assert.equal(duration(agent),3);
  assert.equal(model.timecode(61+29/30,30),'00:01:01:29');assert.equal(model.timecode(1,24),'00:00:01:00');
  assert.equal(model.timecode(1.966666,30),'00:00:01:29');assert.equal(model.timecode(1.94,30),'00:00:01:28');
});
test('linked moves, collision rejection, frame snapping and lock checks share host semantics',()=>{
  const seq=sequence();const moved=M.operate(seq,{action:'move',ids:['first'],linked:true,trackId:'V2',delta:5+1/30});
  assert.equal(moved.items.find(c=>c.id==='first')!.trackId,'V2');assert.equal(moved.items.find(c=>c.linkGroup==='first'&&c.kind==='audio')!.start,5+1/30);
  assert.throws(()=>M.operate(seq,{action:'move',ids:['first'],linked:false,delta:1}),/겹칠/);
  const locked=M.operate(seq,{action:'track',trackId:'V1',patch:{locked:true}});
  for(const op of [{action:'delete',ids:['first']},{action:'split',ids:['first'],time:1},{action:'move',ids:['first'],delta:3},{action:'trim',ids:['first'],edge:'out',delta:-.5}])assert.throws(()=>M.operate(locked,op),/잠겨/);
  assert.equal(model.snap(seq,1.98,['first'],0,100,true),2);assert.equal(model.snap(seq,1.91,['first'],0,100,false),model.frame(1.91));
});
test('split keeps source coverage, pairing and volume automation continuous',()=>{
  let seq=sequence();const audio=seq.items.find(c=>c.kind==='audio')!;
  seq=M.operate(seq,{action:'properties',ids:[audio.id],linked:false,patch:{automation:[{time:0,db:-20},{time:2,db:0}]}});
  const split=M.operate(seq,{action:'split',ids:['first'],time:1,linked:true});
  const left=split.items.find(c=>c.id==='first')!,right=split.items.find(c=>c.kind==='video'&&c.start===1)!;
  assert.equal(left.out-left.in+right.out-right.in,2);assert.equal(right.in,left.out);
  const linkedAudio=split.items.find(c=>c.kind==='audio'&&c.linkGroup===right.id)!;assert.ok(linkedAudio);assert.equal(linkedAudio.start,right.start);assert.equal(linkedAudio.automation![0].db,-10);
  assert.equal(M.duration(split),4);
});
test('normal/ripple/roll trim, slip and slide preserve their distinct invariants',()=>{
  const s=sequence();let next=M.operate(s,{action:'trim',ids:['first'],edge:'in',delta:.5,linked:true});assert.equal(next.items.find(c=>c.id==='first')!.start,.5);assert.equal(next.items.find(c=>c.id==='first')!.in,2.5);assert.equal(M.duration(next),4);
  next=M.operate(s,{action:'ripple',ids:['first'],edge:'out',delta:-.5,linked:true});assert.equal(next.items.find(c=>c.id==='second')!.start,1.5);assert.equal(M.duration(next),3.5);
  next=M.operate(s,{action:'roll',ids:['first'],edge:'out',delta:.5,linked:true});assert.equal(next.items.find(c=>c.id==='second')!.start,2.5);assert.equal(M.duration(next),4);
  next=M.operate(s,{action:'slip',ids:['first'],delta:1,linked:true});assert.equal(next.items.find(c=>c.id==='first')!.in,3);assert.equal(M.duration(next),4);
  const third=M.fromTimeline({version:1,clips:[...base().clips,{id:'third',source:'sources/a.mp4',in:10,out:12}]});
  next=M.operate(third,{action:'slide',ids:['second'],delta:.5,linked:true});assert.equal(next.items.find(c=>c.id==='second')!.start,2.5);assert.equal(M.duration(next),6);
  assert.throws(()=>M.operate(s,{action:'slide',ids:['first'],delta:1}),/양옆/);
});
test('trimming an audio envelope keeps interpolation at both new boundaries',()=>{
  let s=sequence();const audio=s.items.find(c=>c.kind==='audio')!;
  s=M.operate(s,{action:'properties',ids:[audio.id],linked:false,patch:{automation:[{time:0,db:-20},{time:2,db:0}]}});
  const trimmed=M.operate(s,{action:'trim',ids:[audio.id],linked:false,edge:'in',delta:.5}).items.find(c=>c.id===audio.id)!;
  assert.equal(M.volumeAt(trimmed,0),-15);assert.equal(M.volumeAt(trimmed,1.5),0);
  const gain=M.operate(s,{action:'properties',ids:[audio.id],linked:false,patch:{gainDb:-6}}).items.find(c=>c.id===audio.id)!;assert.equal(M.volumeAt(gain,1),-16);
});
test('visual opacity keyframes interpolate and survive splits and trims',()=>{
  let s=sequence();s=M.operate(s,{action:'keyframe',ids:['first'],linked:false,property:'opacity',time:0,value:0});s=M.operate(s,{action:'keyframe',ids:['first'],linked:false,property:'opacity',time:2,value:1});
  assert.equal(model.opacityAt(s.items.find(c=>c.id==='first'),1),.5);
  const split=M.operate(s,{action:'split',ids:['first'],linked:true,time:1}),right=split.items.find(c=>c.kind==='video'&&c.start===1)!;assert.equal(right.opacityAutomation![0].value,.5);
  const trim=M.operate(s,{action:'trim',ids:['first'],linked:false,edge:'in',delta:.5});assert.equal(model.opacityAt(trim.items.find(c=>c.id==='first'),0),.25);
});
test('track output state, marker/keyframe edits and sequence undo survive persistence',async()=>{
  const root=path.resolve(__dirname,'../..','.test-data');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'sequence-undo-'));await writeTimeline(dir,base());const session=new EditSession();
  await session.apply(dir,{action:'sequence',operation:{action:'track',trackId:'A1',patch:{muted:true}}},async()=>{});
  const after=await readTimeline(dir);assert.equal(M.audible(after.sequence!,after.sequence!.tracks.find(t=>t.id==='A1')!),false);
  await session.apply(dir,{action:'undo'},async()=>{});assert.deepEqual(await readTimeline(dir),base());await session.apply(dir,{action:'redo'},async()=>{});assert.deepEqual(await readTimeline(dir),after);
  let s=after.sequence!;s=M.operate(s,{action:'track',trackId:'A2',patch:{solo:true}});assert.equal(M.audible(s,s.tracks.find(t=>t.id==='A1')!),false);assert.equal(M.audible(s,s.tracks.find(t=>t.id==='A2')!),true);
  s=M.operate(s,{action:'marker',time:1.26,label:'검토'});assert.equal(s.markers[0].time,38/30);
  const audio=s.items.find(c=>c.kind==='audio')!;s=M.operate(s,{action:'keyframe',ids:[audio.id],time:1,db:-12,linked:false});assert.equal(M.volumeAt(s.items.find(c=>c.id===audio.id)!,1),-12);
  assert.throws(()=>validate({...base(),sequence:{...s,items:[{...s.items[0],source:'../escape.mp4'}]}}),/source/);
});
test('real sequence export respects layered graphics, gaps, hidden tracks and audio mute',async()=>{
  const root=path.resolve(__dirname,'../..','.test-data');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'sequence-render-'));await fs.mkdir(path.join(dir,'sources'));
  const source=path.join(dir,'sources/a.mp4');await run('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i','color=blue:s=160x90:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-threads','2','-c:a','aac','-shortest',source]);
  let s=M.fromTimeline({version:1,clips:[{id:'v',source:'sources/a.mp4',in:0,out:2}]});
  s=M.operate(s,{action:'insert',item:{id:'overlay',kind:'shape',trackId:'V2',start:0,in:0,out:1,name:'red',style:{x:.5,y:.5,width:1,height:1,color:'#ff0000'}}});
  s=M.operate(s,{action:'insert',item:{id:'caption',kind:'text',trackId:'CC',start:0,in:0,out:1,text:"테스트 ' : ; %",style:{x:.5,y:.8,color:'#ffffff',fontSize:32}}});
  s=M.operate(s,{action:'track',trackId:'A1',patch:{muted:true}});
  const t=M.toTimeline({version:1,clips:[]},s);await validateMedia(dir,t);const output=await exportTimeline(dir,t);
  // Inspect bytes through a binary child to avoid UTF-8 conversion of pixel values.
  const {spawnSync}=await import('node:child_process');
  const pixel=(at:number,file=output)=>{const r=spawnSync('ffmpeg',['-nostdin','-v','error','-ss',String(at),'-i',file,'-frames:v','1','-vf','crop=2:2:640:360,format=rgb24','-f','rawvideo','pipe:1']);assert.equal(r.status,0,String(r.stderr));return r.stdout;};
  const red=pixel(.3),blue=pixel(1.3);assert.ok(red[0]>180&&red[2]<80);assert.ok(blue[2]>180&&blue[0]<80);
  const pcm=spawnSync('ffmpeg',['-nostdin','-v','error','-i',output,'-vn','-ac','1','-ar','8000','-f','s16le','pipe:1']);assert.equal(pcm.status,0);let peak=0;for(let i=0;i+1<pcm.stdout.length;i+=2)peak=Math.max(peak,Math.abs(pcm.stdout.readInt16LE(i)));assert.equal(peak,0);
  let hidden=M.operate(s,{action:'track',trackId:'V2',patch:{visible:false}});hidden=M.operate(hidden,{action:'track',trackId:'A1',patch:{muted:false}});const a=hidden.items.find(c=>c.kind==='audio')!;
  hidden=M.operate(hidden,{action:'properties',ids:[a.id],linked:false,patch:{automation:[{time:0,db:-30},{time:2,db:0}]}});hidden=M.operate(hidden,{action:'move',ids:['v'],delta:.5,linked:true});
  const second=await exportTimeline(dir,M.toTimeline({version:1,clips:[]},hidden));const black=pixel(.2,second),blue2=pixel(.8,second);assert.ok(Math.max(...black.subarray(0,3))<12);assert.ok(blue2[2]>180&&blue2[0]<80);
  const rms=(at:number)=>{const r=spawnSync('ffmpeg',['-nostdin','-v','error','-ss',String(at),'-i',second,'-t','0.2','-vn','-ac','1','-ar','8000','-f','s16le','pipe:1']);assert.equal(r.status,0,String(r.stderr));let sum=0;for(let i=0;i+1<r.stdout.length;i+=2)sum+=r.stdout.readInt16LE(i)**2;return Math.sqrt(sum/(r.stdout.length/2));};assert.ok(rms(2.1)>rms(.7)*3,'exported automation changes real PCM amplitude');
  const animated=M.operate(s,{action:'properties',ids:['overlay'],linked:false,patch:{opacityAutomation:[{time:0,value:0},{time:1,value:1}]}}),third=await exportTimeline(dir,M.toTimeline({version:1,clips:[]},animated));const faint=pixel(.2,third),strong=pixel(.8,third);assert.ok(strong[0]>faint[0]+60&&faint[2]>strong[2]+60,'exported opacity keyframes change actual composited pixels');
});
