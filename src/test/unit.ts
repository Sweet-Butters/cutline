import './check-unit';
import './signals-unit';
import {test} from 'node:test';
import './agent-unit';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {validate,diffTimeline,edit,writeTimeline,readTimeline,transcripts} from '../core';
import {proxyKey,validateMedia,run,ensureProxy} from '../media';
import {referenceMetrics} from '../reference';
import {version,versions,restore} from '../history';
const base=path.resolve(__dirname,'../..');
const t=()=>validate({version:1,clips:[{id:'a',source:'sources/a.mp4',in:0,out:10},{id:'b',source:'sources/a.mp4',in:10,out:20}]});
test('reference metrics use original source union, independent of edit order',()=>{
  assert.equal(referenceMetrics(t(),t()).f1,1);
  const human=t();human.clips=[{id:'h',source:'sources/a.mp4',in:10,out:30}];
  const m=referenceMetrics(t(),human);assert.equal(m.overlap,10);assert.equal(m.precision,.5);assert.equal(m.recall,.5);assert.equal(m.f1,.5);
  const repeated=t();repeated.clips.push({...repeated.clips[0],id:'repeat'});repeated.clips.reverse();
  assert.equal(referenceMetrics(repeated,t()).f1,1);assert.equal(referenceMetrics(repeated,t()).aiDuration,30);
  human.clips[0].source='sources/b.mp4';assert.equal(referenceMetrics(t(),human).f1,0);
  const empty=validate({version:1,clips:[]});assert.equal(referenceMetrics(empty,empty).f1,1);assert.equal(referenceMetrics(empty,t()).f1,0);
});
test('launcher actually resolves explicit folders and preserves copied sample edits',async()=>{
  if(process.platform==='win32')assert.match(await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(base,'app/test-launcher.ps1')]),/passed/);
});
test('workspace defaults hide internal files and keep terminal closed',async()=>{
  const manifest=JSON.parse(await fs.readFile(path.join(base,'package.json'),'utf8'));
  const excludes=manifest.contributes.configurationDefaults['files.exclude'];
  for(const name of ['**/.cutline-cache','**/.git','**/node_modules','**/.timeline-*.tmp'])assert.equal(excludes[name],true);
  assert.equal(manifest.contributes.configuration.properties['cutline.openTerminal'].default,false);
});
test('concurrent proxy requests share one generation and report progress',async()=>{
  const dir=await fs.mkdtemp(path.join(base,'.test-data','proxy-'));await fs.mkdir(path.join(dir,'sources'));
  await run('ffmpeg',['-nostdin','-v','error','-y','-i',path.join(base,'sample-project/sources/camera-1.mp4'),'-t','1','-c','copy',path.join(dir,'sources/a.mp4')]);
  const messages:string[]=[];const first=ensureProxy(dir,'sources/a.mp4','webm',m=>messages.push(m));const second=ensureProxy(dir,'sources/a.mp4');assert.equal(first,second);
  assert.equal(await first,await second);assert.ok(messages.some(m=>m.includes('Generating playback proxy')));
  assert.equal((await fs.readdir(path.join(dir,'.cutline-cache'))).length,1);
});
test('schema rejects invalid times, ids, and unsafe sources; accepts empty and fractional times',()=>{
  for(const change of [{in:-1},{out:0},{out:Infinity},{in:'0'},{source:'../a.mp4'},{source:'sources/../a.mp4'},{source:'sources/C:/a.mp4'},{source:'sources/a\\b.mp4'},{id:''},{reason:42}]){const x=t();Object.assign(x.clips[0],change);assert.throws(()=>validate(x));}
  const dup=t();dup.clips[1].id='a';assert.throws(()=>validate(dup));assert.throws(()=>validate(null));assert.throws(()=>validate({version:2,clips:[]}));
  assert.deepEqual(validate({version:1,clips:[]}).clips,[]);const frac=t();frac.clips[0].in=.25;assert.equal(validate(frac).clips[0].in,.25);
});
test('diff identifies added, removed, trimmed, reorders and reason-only changes',()=>{
  const a=t();const b=edit(edit(a,'remove',['a']),'add',['c','sources/a.mp4','30','35']);b.clips[0].in=12;
  const d=diffTimeline(a,b);assert.deepEqual(d.added.map(c=>c.id),['c']);assert.deepEqual(d.removed.map(c=>c.id),['a']);assert.deepEqual(d.trimmed.map(c=>c.id),['b']);assert.deepEqual(d.moved,[]);assert.equal(d.before,20);assert.equal(d.after,13);
  assert.deepEqual(diffTimeline(a,edit(a,'move',['b','0'])).moved,['b','a']);
  const reason=t();reason.clips[0].reason='new';assert.deepEqual(diffTimeline(a,reason).changed,['a']);assert.deepEqual(diffTimeline(a,a).added,[]);
});
test('CLI editing operations are immutable, ordered and validated',()=>{
  const a=t();let b=edit(a,'add',['c','sources/a.mp4','20','24','선택 이유']);b=edit(b,'move',['c','0']);b=edit(b,'trim',['c','21','23']);b=edit(b,'remove',['b']);
  assert.deepEqual(b.clips.map(c=>c.id),['c','a']);assert.equal(b.clips[0].in,21);assert.equal(b.clips[0].reason,'선택 이유');assert.equal(a.clips.length,2);
  assert.throws(()=>edit(a,'trim',['a','10','3']));assert.throws(()=>edit(a,'move',['b','-1']));assert.throws(()=>edit(a,'remove',['unknown']));
});
test('proxy keys depend on bytes and profile, not path; Unicode paths work',async()=>{
  const dir=path.join(base,'.test-data','키 검사');await fs.mkdir(dir,{recursive:true});const a=path.join(dir,'가 파일'),b=path.join(dir,'나 파일');await fs.writeFile(a,'abc');await fs.copyFile(a,b);
  assert.equal(await proxyKey(a),await proxyKey(b));assert.notEqual(await proxyKey(a),await proxyKey(a,'new-profile'));const old=await proxyKey(a);await fs.writeFile(a,'abd');assert.notEqual(await proxyKey(a),old);
});
test('CLI process, media bounds, Unicode paths, transcripts and git round trip',async()=>{
  await fs.mkdir(path.join(base,'.test-data'),{recursive:true});const dir=await fs.mkdtemp(path.join(base,'.test-data','한글 프로젝트 '));await fs.mkdir(path.join(dir,'sources'),{recursive:true});await fs.mkdir(path.join(dir,'transcripts'),{recursive:true});
  await fs.copyFile(path.join(base,'sample-project','sources','camera-1.mp4'),path.join(dir,'sources','영상 하나.mp4'));
  await writeTimeline(dir,{version:1,clips:[{id:'a',source:'sources/영상 하나.mp4',in:0,out:5}]});
  const cli=(...args:string[])=>run(process.execPath,[path.join(base,'tools','vidcli.js'),'--project',dir,...args]);
  await cli('validate');await cli('add','b','sources/영상 하나.mp4','10','15','핵심 이유');await cli('trim','b','11','14');await cli('move','b','0');await cli('remove','a');
  const summary=JSON.parse(await cli('summary'));assert.equal(summary.duration,3);assert.equal(summary.timeline.clips[0].id,'b');
  await assert.rejects(()=>cli('trim','b','0','999'),/exceeds/);assert.equal((await readTimeline(dir)).clips[0].in,11);
  await fs.writeFile(path.join(dir,'transcripts','영상 하나.mp4.json'),JSON.stringify([{start:10,end:15,text:'핵심 아이디어'}]));assert.equal(Object.keys(await transcripts(dir)).length,1);assert.match(await cli('search','핵심'),/핵심 아이디어/);
  const bad=await readTimeline(dir);bad.clips[0].source='sources/missing.mp4';await assert.rejects(()=>validateMedia(dir,bad),/ENOENT/);
  await run('git',['init'],dir);await run('git',['config','user.name','Test'],dir);await run('git',['config','user.email','test@example.invalid'],dir);
  await cli('commit','첫 버전');const list=await versions(dir);assert.ok(list.length);assert.deepEqual(await version(dir,list[0].hash),await readTimeline(dir));
  await cli('trim','b','10','12');await restore(dir,list[0].hash);assert.equal((await readTimeline(dir)).clips[0].in,11);assert.equal((await readTimeline(dir)).clips[0].out,14);
  // Export a short clip through the real CLI and verify resulting container duration.
  const exported=(await cli('export')).trim();const info=JSON.parse(await run('ffprobe',['-v','error','-show_format','-of','json',exported]));assert.ok(Math.abs(Number(info.format.duration)-3)<.2);
  await run('ffmpeg',['-nostdin','-v','error','-y','-i',path.join(dir,'sources','영상 하나.mp4'),'-t','1','-an','-c:v','copy',path.join(dir,'sources','무음.mp4')]);
  await cli('add','silent','sources/무음.mp4','0','1');const joined=(await cli('export')).trim();const joinedInfo=JSON.parse(await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',joined]));assert.ok(Math.abs(Number(joinedInfo.format.duration)-4)<.2);assert.equal(joinedInfo.streams.find((s:any)=>s.codec_type==='audio').codec_name,'aac');assert.equal(joinedInfo.streams.find((s:any)=>s.codec_type==='video').width,1280);
});
