import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {validate,diffTimeline,edit,writeTimeline,readTimeline,transcripts} from '../core';
import {proxyKey,validateMedia,run} from '../media';
import {version,versions,commit} from '../history';
const base=path.resolve(__dirname,'../..');
const t=()=>validate({version:1,clips:[{id:'a',source:'sources/a.mp4',in:0,out:10},{id:'b',source:'sources/a.mp4',in:10,out:20}]});
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
  const dir=path.join(base,'.test-data','한글 프로젝트');await fs.mkdir(path.join(dir,'sources'),{recursive:true});await fs.mkdir(path.join(dir,'transcripts'),{recursive:true});
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
  // Export a short clip through the real CLI and verify resulting container duration.
  const exported=(await cli('export')).trim();const info=JSON.parse(await run('ffprobe',['-v','error','-show_format','-of','json',exported]));assert.ok(Math.abs(Number(info.format.duration)-3)<.2);
});
