import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sourcePath,validate,Segment,Timeline,transcripts} from './core';
import {cacheDirectory,proxyKey,probe} from './media';

const PROFILE='audio-rms-mono-8000-v1';
const db=(power:number)=>Math.max(-120,10*Math.log10(Math.max(1e-12,power)));
export interface SignalWindow {start:number;end:number;db:number;percentile:number}
export interface Signal {version:1;source:string;hash:string;duration:number;audio:boolean;seconds:{start:number;end:number;power:number}[];windows:SignalWindow[]}
export interface Candidate {source:string;start:number;end:number;db:number;transcript:Segment[]}
async function atomic(file:string,value:unknown) {
  await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
  try {await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
export function signalPath(root:string,source:string){
  validate({version:1,clips:[{id:'signal',source,in:0,out:1}]});
  return path.join(root,'signals',source.slice(8)+'.json');
}
export async function computeSignal(root:string,source:string,publish=true):Promise<Signal> {
  signalPath(root,source);
  const file=await sourcePath(root,source),hash=await proxyKey(file,PROFILE),cache=path.join(cacheDirectory(root),hash+'.signals.json');
  let signal:Signal;
  try {signal=JSON.parse(await fs.readFile(cache,'utf8'));signal.source=source;}
  catch(e) {
    if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    const meta=await probe(file),seconds:Signal['seconds']=[];
    if(meta.audio)await new Promise<void>((resolve,reject)=>{
      const child=spawn('ffmpeg',['-nostdin','-v','error','-i',file,'-map','0:a:0','-vn','-ac','1','-ar','8000','-f','s16le','pipe:1'],{windowsHide:true});
      let pending=Buffer.alloc(0),sum=0,count=0,samples=0,err='';
      const flush=()=>{if(count){const end=Math.min(samples/8000,meta.duration),start=seconds.length;if(end>start)seconds.push({start,end,power:sum/count});sum=0;count=0;}};
      child.stdout.on('data',(chunk:Buffer)=>{const data=Buffer.concat([pending,chunk]);let i=0;for(;i+1<data.length;i+=2){const value=data.readInt16LE(i)/32768;sum+=value*value;count++;samples++;if(count===8000)flush();}pending=Buffer.from(data.subarray(i));});
      child.stderr.on('data',d=>err=(err+d).slice(-4000));child.on('error',reject);
      child.on('close',code=>{if(code!==0){reject(Error('Audio decode failed: '+err));return;}flush();resolve();});
    });
    if(!meta.audio)for(let start=0;start<meta.duration;start++)seconds.push({start,end:Math.min(start+1,meta.duration),power:0});
    const windows:SignalWindow[]=[];
    for(let i=0;i<seconds.length;i+=5){const bins=seconds.slice(i,i+5),end=bins[bins.length-1].end;windows.push({start:i,end,db:db(bins.reduce((n,b)=>n+b.power*(b.end-b.start),0)/(end-i)),percentile:0});}
    const sorted=windows.map(w=>w.db).sort((a,b)=>a-b);
    // Midrank percentiles keep equal-loudness windows equal, including silence.
    const ranks=new Map<number,number>();for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j]===sorted[i])j++;ranks.set(sorted[i],100*(i+(j-i)/2)/sorted.length);i=j;}
    for(const w of windows)w.percentile=ranks.get(w.db)!;
    signal={version:1,source,hash,duration:meta.duration,audio:meta.audio,seconds,windows};await atomic(cache,signal);
  }
  if(publish)await atomic(signalPath(root,source),signal);
  return signal;
}
export async function readSignalWindows(root:string,source:string):Promise<SignalWindow[]> {
  try {const data=JSON.parse(await fs.readFile(signalPath(root,source),'utf8')) as Signal;return data.windows;}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  // Read-only projects can keep signals exclusively in the cache.
  const cache=cacheDirectory(root),files=await fs.readdir(cache).catch(()=>[]);
  if(!files.some(f=>f.endsWith('.signals.json')))return [];
  const hash=await proxyKey(await sourcePath(root,source),PROFILE);
  try {return (JSON.parse(await fs.readFile(path.join(cache,hash+'.signals.json'),'utf8')) as Signal).windows;}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
}
export async function sourceList(root:string,source?:string):Promise<string[]> {
  if(source){await sourcePath(root,source);signalPath(root,source);return [source];}
  const result:string[]=[];
  async function walk(dir:string){for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const name=dir+'/'+item.name;if(item.isDirectory())await walk(name);else if(item.isFile()&&/\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(item.name))result.push(name);}}
  await walk('sources');if(!result.length)throw Error('No video sources found');return result.sort();
}
export function rankCandidates(signals:Signal[],target:number,win:number,text:Record<string,Segment[]>={}):Candidate[] {
  if(!Number.isFinite(target)||target<=0)throw Error('--target must be positive seconds');
  if(![10,20,30].includes(win))throw Error('--win must be 10, 20 or 30');
  const windows:Candidate[]=[];
  for(const signal of signals){
    const bins=signal.seconds,prefix=[0];for(const b of bins)prefix.push(prefix[prefix.length-1]+b.power*(b.end-b.start));
    const length=Math.min(win,bins.length);
    for(let i=0;i+length<=bins.length&&length;i++){const end=bins[i+length-1].end;windows.push({source:signal.source,start:i,end,db:db((prefix[i+length]-prefix[i])/(end-i)),transcript:[]});}
  }
  windows.sort((a,b)=>Math.round(b.db*1e6)-Math.round(a.db*1e6)||a.source.localeCompare(b.source)||a.start-b.start);
  const chosen:Candidate[]=[];let total=0;
  for(const w of windows){if(total>=2*target)break;if(chosen.some(c=>c.source===w.source&&c.start<w.end&&c.end>w.start))continue;chosen.push({...w});total+=w.end-w.start;}
  chosen.sort((a,b)=>a.source.localeCompare(b.source)||a.start-b.start);
  const scenes:Candidate[]=[];
  for(const w of chosen){const last=scenes[scenes.length-1];if(last&&last.source===w.source&&Math.abs(last.end-w.start)<.001){last.db=db((Math.pow(10,last.db/10)*(last.end-last.start)+Math.pow(10,w.db/10)*(w.end-w.start))/(w.end-last.start));last.end=w.end;}else scenes.push({...w});}
  for(const c of scenes){const lines=text[c.source]||[];const distance=(s:Segment)=>Math.max(c.start-s.end,s.start-c.end,0);c.transcript=[...lines].sort((a,b)=>distance(a)-distance(b)||a.start-b.start).slice(0,8).sort((a,b)=>a.start-b.start);}
  return scenes.sort((a,b)=>b.db-a.db||a.source.localeCompare(b.source)||a.start-b.start);
}
export function candidateTimeline(candidates:Candidate[],target:number):Timeline {
  const selected:Candidate[]=[];let total=0;
  for(const c of candidates)if(total+c.end-c.start<=target+.001){selected.push(c);total+=c.end-c.start;}
  if(!selected.length)throw Error('No whole candidate scene fits --target; increase target or refine scenes manually. Timeline unchanged.');
  selected.sort((a,b)=>a.source.localeCompare(b.source)||a.start-b.start);
  return {version:1,clips:selected.map((c,i)=>({id:'signal-'+(i+1),source:c.source,in:c.start,out:c.end,reason:'소리 신호 후보 · 장면과 대사 맥락 검토 필요'}))};
}
export async function candidates(root:string,target:number,win:number,source?:string){
  if(!Number.isFinite(target)||target<=0||![10,20,30].includes(win))throw Error('Require --target > 0 and --win 10|20|30');
  const signals:Signal[]=[];for(const s of await sourceList(root,source))signals.push(await computeSignal(root,s));
  return rankCandidates(signals,target,win,await transcripts(root));
}
