import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Timeline,sourcePath} from './core';
import {run,probe,proxyKey,cacheDirectory,ensureProxy,ProxyFormat} from './media';
import {computeSignal} from './signals';
import {sequenceModel,SequenceItem} from './sequence';

export interface SequenceAsset {url:string;thumbnail?:string;duration:number;audio:boolean;video:boolean;waveform:{start:number;end:number;power:number}[]}
const jobs=new Map<string,Promise<Omit<SequenceAsset,'url'|'thumbnail'>&{file:string;thumbnailFile?:string}>>();
/** Cache analysis by content; every URL is registered with the existing tokenized server. */
export async function prepareSequenceAssets(root:string,t:Timeline,format:ProxyFormat,register:(file:string)=>string,progress:(message:string)=>void){
  const seq=sequenceModel.fromTimeline(t),assets:Record<string,SequenceAsset>={};
  for(const source of new Set(seq.items.map(c=>c.source).filter((x):x is string=>!!x))){
    const sourceFile=await sourcePath(root,source),stat=await fs.stat(sourceFile);
    const id=JSON.stringify([root,source,stat.size,stat.mtimeMs,format]);
    let job=jobs.get(id);
    if(!job){job=(async()=>{
      const meta=await probe(sourceFile,true),cache=cacheDirectory(root);await fs.mkdir(cache,{recursive:true});
      let file:string,thumbnailFile:string|undefined;
      if(meta.video){
        file=await ensureProxy(root,source,format,progress);
        const key=await proxyKey(sourceFile,'sequence-thumbnail-160-v1');thumbnailFile=path.join(cache,key+'.jpg');
        try{await fs.access(thumbnailFile);}catch{
          const temp=thumbnailFile+'.'+randomUUID()+'.jpg';
          try{await run('ffmpeg',['-nostdin','-v','error','-y','-i',sourceFile,'-frames:v','1','-vf','scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2',temp]);await fs.rename(temp,thumbnailFile);}finally{await fs.rm(temp,{force:true});}
        }
      }else{
        const key=await proxyKey(sourceFile,'sequence-audio-mp3-v1');file=path.join(cache,key+'.mp3');
        try{await fs.access(file);}catch{
          const temp=file+'.'+randomUUID()+'.mp3';
          try{await run('ffmpeg',['-nostdin','-v','error','-y','-i',sourceFile,'-vn','-c:a','libmp3lame','-b:a','128k',temp]);await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
        }
      }
      progress('오디오 파형 분석 · '+source);
      const signal=await computeSignal(root,source,false);
      return {...meta,file,thumbnailFile,waveform:signal.seconds};
    })();jobs.set(id,job);job.catch(()=>jobs.delete(id));}
    const {file,thumbnailFile,...meta}=await job;
    assets[source]={...meta,url:register(file),...(thumbnailFile?{thumbnail:register(thumbnailFile)}:{})};
  }
  return assets;
}
const num=(n:number)=>Number(n.toFixed(6)).toString();
const filterPath=(s:string)=>s.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"'\\''");
function envelope(c:SequenceItem){
  const keys=c.automation||[];
  if(!keys.length)return num(c.gainDb||0);
  let expression=num(keys.at(-1)!.db);
  for(let i=keys.length-2;i>=0;i--){const a=keys[i],b=keys[i+1],linear=`${num(a.db)}+(${num(b.db-a.db)})*(t-${num(a.time)})/${num(b.time-a.time)}`;expression=`if(lt(t,${num(b.time)}),${linear},${expression})`;}
  return `if(lt(t,${num(keys[0].time)}),${num(keys[0].db)},${expression})`;
}
function opacityEnvelope(c:SequenceItem,time:string){
  const keys=c.opacityAutomation||[];if(!keys.length)return num(c.effects?.opacity??1);let expression=num(keys.at(-1)!.value);
  for(let i=keys.length-2;i>=0;i--){const a=keys[i],b=keys[i+1];expression=`if(lt(${time},${num(b.time)}),${num(a.value)}+(${num(b.value-a.value)})*(${time}-${num(a.time)})/${num(b.time-a.time)},${expression})`;}
  return `if(lt(${time},${num(keys[0].time)}),${num(keys[0].value)},${expression})`;
}
async function fontFile(){
  const candidates=process.platform==='darwin'?['/System/Library/Fonts/AppleSDGothicNeo.ttc','/System/Library/Fonts/Supplemental/Arial Unicode.ttf','/System/Library/Fonts/Helvetica.ttc']:process.platform==='win32'?['C:/Windows/Fonts/malgun.ttf','C:/Windows/Fonts/arial.ttf']:['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  for(const file of candidates)if(await fs.stat(file).catch(()=>false))return file;
  return undefined;
}
export async function exportSequence(root:string,t:Timeline,report:unknown){
  const seq=sequenceModel.fromTimeline(t),seconds=sequenceModel.duration(seq);
  if(!seconds)throw Error('Cannot export an empty sequence');
  const outDir=path.join(root,'exports'),cache=cacheDirectory(root);await fs.mkdir(outDir,{recursive:true});await fs.mkdir(cache,{recursive:true});
  const temp=await fs.mkdtemp(path.join(cache,'sequence-export-'));
  const output=path.join(outDir,`edit-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.mp4`);
  try{
    const args=['-nostdin','-v','error','-y','-f','lavfi','-i',`color=c=black:s=1280x720:r=${seq.fps}:d=${num(seconds)}`];
    const sources=new Map<string,{index:number;audio:boolean}>();
    for(const source of new Set(seq.items.map(c=>c.source).filter((s):s is string=>!!s))){
      const file=await sourcePath(root,source),meta=await probe(file,true);sources.set(source,{index:sources.size+1,audio:meta.audio});args.push('-i',file);
    }
    const filters=['[0:v]format=yuv420p[base0]'],audio:string[]=[];
    let base='base0',serial=0;
    const font=await fontFile();
    const visual=seq.items.filter(c=>c.kind!=='audio'&&seq.tracks.find(t=>t.id===c.trackId)?.visible!==false).sort((a,b)=>seq.tracks.find(t=>t.id===b.trackId)!.order-seq.tracks.find(t=>t.id===a.trackId)!.order||a.start-b.start);
    for(const c of visual){
      const n=++serial,label='base'+n,style=c.style||{},enable=`gte(t,${num(c.start)})*lt(t,${num(sequenceModel.end(c))})`,opacity=(c.effects?.opacity??1)*(style.opacity??1);
      if(c.kind==='video'){
        const w=Math.max(2,Math.round((style.width??1)*1280/2)*2),h=Math.max(2,Math.round((style.height??1)*720/2)*2),x=Math.round((style.x??.5)*1280-w/2),y=Math.round((style.y??.5)*720-h/2),brightness=c.effects?.brightness??1;
        const alpha=c.opacityAutomation?.length?`,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityEnvelope(c,'(T-'+num(c.start)+')')})*${num(style.opacity??1)}'`:'';
        filters.push(`[${sources.get(c.source!)!.index}:v]trim=start=${num(c.in)}:end=${num(c.out)},setpts=PTS-STARTPTS+${num(c.start)}/TB,fps=${seq.fps},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=rr=${num(brightness)}:gg=${num(brightness)}:bb=${num(brightness)}:aa=${c.opacityAutomation?.length?'1':num(opacity)}${alpha}[visual${n}]`);
        filters.push(`[${base}][visual${n}]overlay=x=${x}:y=${y}:eof_action=pass:enable='${enable}'[${label}]`);
      }else if(c.kind==='shape'){
        const w=Math.max(1,Math.round((style.width??.3)*1280)),h=Math.max(1,Math.round((style.height??.15)*720)),x=Math.round((style.x??.5)*1280-w/2),y=Math.round((style.y??.5)*720-h/2);
        if(c.opacityAutomation?.length){filters.push(`color=c=${(style.color||'#70c8ff').replace('#','0x')}:s=${Math.max(2,w)}x${Math.max(2,h)}:r=${seq.fps}:d=${num(c.out-c.in)},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*(${opacityEnvelope(c,'T')})*${num(style.opacity??1)}',setpts=PTS+${num(c.start)}/TB[shape${n}]`);filters.push(`[${base}][shape${n}]overlay=x=${x}:y=${y}:eof_action=pass:enable='${enable}'[${label}]`);}
        else filters.push(`[${base}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${(style.color||'#70c8ff').replace('#','0x')}@${num(opacity)}:t=fill:enable='${enable}'[${label}]`);
      }else{
        const textFile=path.join(temp,`text-${n}.txt`);await fs.writeFile(textFile,c.text||'','utf8');
        filters.push(`[${base}]drawtext=${font?`fontfile='${filterPath(font)}':`:''}textfile='${filterPath(textFile)}':expansion=none:fontsize=${style.fontSize??42}:fontcolor=${(style.color||'#ffffff').replace('#','0x')}:alpha='(${opacityEnvelope(c,'(t-'+num(c.start)+')')})*${num(style.opacity??1)}':x=w*${num(style.x??.5)}-text_w/2:y=h*${num(style.y??.85)}-text_h/2:enable='${enable}'[${label}]`);
      }
      base=label;
    }
    for(const c of seq.items.filter(c=>c.kind==='audio')){
      const track=seq.tracks.find(t=>t.id===c.trackId)!;
      if(!sequenceModel.audible(seq,track)||!sources.get(c.source!)?.audio)continue;
      const label='audio'+audio.length,db=`(${envelope(c)})+${num((track.gainDb||0)+seq.mixDb)}`;
      filters.push(`[${sources.get(c.source!)!.index}:a]atrim=start=${num(c.in)}:end=${num(c.out)},asetpts=PTS-STARTPTS,volume='pow(10,(${db})/20)':eval=frame,adelay=${Math.round(c.start*1000)}:all=1,apad=whole_dur=${num(seconds)}[${label}]`);audio.push(label);
    }
    if(audio.length)filters.push(`${audio.map(a=>'['+a+']').join('')}amix=inputs=${audio.length}:normalize=0:dropout_transition=0[aout]`);
    else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${num(seconds)}[aout]`);
    const script=path.join(temp,'filters.txt');await fs.writeFile(script,filters.join(';\n'));
    args.push('-filter_complex_threads','1','-filter_complex',filters.join(';\n'),'-map','['+base+']','-map','[aout]','-t',num(seconds),'-r',String(seq.fps),'-c:v','libx264','-preset','veryfast','-crf','20','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',output);
    await run('ffmpeg',args);
    await fs.writeFile(output.replace(/\.mp4$/,'.report.json'),JSON.stringify({...report as object,sequence:true,exportedAt:new Date().toISOString()},null,2)+'\n');
    return output;
  }catch(error){await fs.rm(output,{force:true});throw error;}finally{await fs.rm(temp,{recursive:true,force:true});}
}
