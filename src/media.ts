import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,ChildProcess} from 'node:child_process';
import {Timeline, sourcePath, validate} from './core';
import {checkProject,hardFailures} from './check';
const children=new Set<ChildProcess>();
export function stopMediaWorkers(){for(const child of children)child.kill();}
process.once('exit',stopMediaWorkers);

export function run(program: string, args: string[], cwd?: string, onOutput?:(chunk:string)=>void): Promise<string> {
  return new Promise((resolve,reject)=>{
    const child=spawn(program,args,{cwd,windowsHide:true,shell:false});
    children.add(child);child.once('close',()=>children.delete(child));
    let out='',err='';
    child.stdout.on('data',d=>{out+=d;onOutput?.(String(d));}); child.stderr.on('data',d=>{err=(err+d).slice(-16000);});
    child.on('error',reject); child.on('close',code=>code===0?resolve(out):reject(Error(`${program} exited ${code}: ${err}`)));
  });
}
export async function probe(file: string): Promise<{duration:number;audio:boolean}> {
  const data=JSON.parse(await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file]));
  const duration=Number(data.format.duration);
  if(!data.streams.some((s:any)=>s.codec_type==='video') || !Number.isFinite(duration)||duration<=0) throw Error(`Not a finite video: ${file}`);
  return {duration,audio:data.streams.some((s:any)=>s.codec_type==='audio')};
}
export async function validateMedia(root: string,t: Timeline) {
  validate(t);
  const metadata=new Map<string,Awaited<ReturnType<typeof probe>>>();
  for(const c of t.clips) {
    if(!metadata.has(c.source)) metadata.set(c.source,await probe(await sourcePath(root,c.source)));
    if(c.out>metadata.get(c.source)!.duration+0.025) throw Error(`${c.id}: out ${c.out} exceeds source duration ${metadata.get(c.source)!.duration}`);
  }
  return metadata;
}
export const PROXY_PROFILE='vp8-vorbis-640x360-24fps-v1';
export type ProxyFormat='webm'|'mp4';
export async function proxyKey(file: string, profile=PROXY_PROFILE, progress?:(message:string)=>void) {
  const hash=createHash('sha256');hash.update(profile+'\0');
  const size=(await fs.stat(file)).size;let bytes=0,last=0;
  for await(const chunk of createReadStream(file)) {hash.update(chunk);bytes+=chunk.length;if(Date.now()-last>500){progress?.(`Reading source · ${(bytes/size*100).toFixed(0)}%`);last=Date.now();}}
  return hash.digest('hex');
}
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T> {const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;}
// An on-disk lock also serializes independent CLI and extension processes per project.
export function cacheDirectory(root:string) {
  return process.env.CUTLINE_CACHE_ROOT?path.join(process.env.CUTLINE_CACHE_ROOT,createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0,24)):path.join(root,'.cutline-cache');
}
async function locked<T>(root:string,fn:()=>Promise<T>) {
  const cache=cacheDirectory(root); await fs.mkdir(cache,{recursive:true});
  const lock=path.join(cache,'ffmpeg.lock'); let handle:fs.FileHandle|undefined;
  while(!handle) {
    try {handle=await fs.open(lock,'wx');await handle.writeFile(String(process.pid));}
    catch(e) {
      if((e as NodeJS.ErrnoException).code!=='EEXIST') throw e;
      try { const pid=Number(await fs.readFile(lock,'utf8')); if(pid>0) {try {process.kill(pid,0);} catch(error) {if((error as NodeJS.ErrnoException).code==='ESRCH') await fs.rm(lock,{force:true});}} } catch {}
      await new Promise(r=>setTimeout(r,250));
    }
  }
  try{return await fn();}finally{await handle.close();await fs.rm(lock,{force:true});}
}
const pending=new Map<string,{promise:Promise<string>;listeners:Set<(message:string)=>void>;message:string}>();
export function ensureProxy(root:string,source:string,format:ProxyFormat='webm',progress?:(message:string)=>void):Promise<string> {
  const id=JSON.stringify([path.resolve(root),source,format]);
  const existing=pending.get(id);
  if(existing){if(progress){existing.listeners.add(progress);progress(existing.message);}return existing.promise;}
  const job={promise:Promise.resolve(''),listeners:new Set<(message:string)=>void>(),message:'Checking source…'};
  if(progress)job.listeners.add(progress);
  const notify=(message:string)=>{job.message=message;for(const listener of job.listeners)listener(message);};
  job.promise=buildProxy(root,source,format,notify).finally(()=>pending.delete(id));pending.set(id,job);return job.promise;
}
async function buildProxy(root:string,source:string,format:ProxyFormat,progress:(message:string)=>void):Promise<string> {
  progress('Reading source…');
  const file=await sourcePath(root,source), key=await proxyKey(file,format==='webm'?PROXY_PROFILE:'h264-mp3-640x360-24fps-v1',progress);
  const target=path.join(cacheDirectory(root),key+'.'+format);
  progress('Waiting for proxy worker…');
  return serial(()=>locked(root,async()=>{
    try {await fs.access(target);return target;} catch {}
    const temp=target+'.'+randomUUID()+'.'+format;
    try {
      const codecs=format==='webm'?['-c:v','libvpx','-deadline','realtime','-cpu-used','8','-threads','2','-b:v','700k','-c:a','libvorbis','-q:a','3']:['-c:v','libx264','-preset','veryfast','-crf','26','-threads','2','-pix_fmt','yuv420p','-c:a','libmp3lame','-b:a','96k','-movflags','+faststart'];
      const {duration}=await probe(file);let buffer='';
      progress('Generating playback proxy · 0%');
      await run('ffmpeg',['-nostdin','-v','error','-progress','pipe:1','-stats_period','1','-y','-i',file,'-map','0:v:0','-map','0:a:0?','-vf','scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=24',...codecs,temp],undefined,chunk=>{
        buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop()!;
        for(const line of lines)if(line.startsWith('out_time_us=')){const seconds=Number(line.split('=')[1])/1e6;if(Number.isFinite(seconds))progress(`Generating playback proxy · ${Math.min(100,seconds/duration*100).toFixed(1)}% · ${Math.floor(seconds)} / ${Math.ceil(duration)} source seconds`);}
      });
      await fs.rename(temp,target);return target;
    } finally {await fs.rm(temp,{force:true});}
  }));
}
export async function exportTimeline(root:string,t:Timeline,confirm?:(report:Awaited<ReturnType<typeof checkProject>>)=>Promise<boolean>):Promise<string> {
  t=structuredClone(t);
  const report=await checkProject(root,t);
  if(hardFailures(report.results)&&!(await confirm?.(report)))throw Error('hard FAIL: 검증표 확인 후 내보내기를 승인하세요 (CLI: export --allow-hard-fail)');
  const meta=await validateMedia(root,t);
  if(!t.clips.length) throw Error('Cannot export an empty timeline');
  return serial(()=>locked(root,async()=>{
    const dir=path.join(root,'exports');await fs.mkdir(dir,{recursive:true});
    const temp=await fs.mkdtemp(path.join(cacheDirectory(root),'export-'));
    const output=path.join(dir,`edit-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.mp4`);
    try {
      for(let i=0;i<t.clips.length;i++) {
        const c=t.clips[i], length=String(c.out-c.in),audio=meta.get(c.source)!.audio;
        const args=['-nostdin','-v','error','-y','-ss',String(c.in),'-i',await sourcePath(root,c.source)];
        if(!audio) args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
        args.push('-t',length,'-map','0:v:0','-map',audio?'0:a:0':'1:a:0','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30','-c:v','libx264','-preset','veryfast','-crf','20','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-af','apad','-video_track_timescale','90000',path.join(temp,`${i}.mp4`));
        await run('ffmpeg',args);
      }
      await fs.writeFile(path.join(temp,'list.txt'),t.clips.map((_,i)=>`file '${i}.mp4'`).join('\n'));
      await run('ffmpeg',['-nostdin','-v','error','-y','-f','concat','-safe','1','-i',path.join(temp,'list.txt'),'-c','copy','-movflags','+faststart',output]);
      await fs.writeFile(output.replace(/\.mp4$/,'.report.json'),JSON.stringify({...report,exportedAt:new Date().toISOString(),hardFailOverride:hardFailures(report.results)},null,2)+'\n');
      return output;
    } catch(e) {await fs.rm(output,{force:true});throw e;} finally {await fs.rm(temp,{recursive:true,force:true});}
  }));
}
