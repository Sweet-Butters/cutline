import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {Timeline,Clip,Segment,transcripts,sourcePath,duration} from './core';
import {probe} from './media';

export type Range = [number,number];
export interface Spec { version?: string; targetDuration?: Range; minClipLength?: number; maxClipLength?: number; requiredKeywords?: string[]; forbiddenKeywords?: string[] }
export interface Style { version?: string; targetDuration?: Range; clipLengthMedian?: Range; clipLengthIQR?: Range; maxOutsideIQRShare?: number; keepRatio?: Range }
export interface Offense { clipId:string; source:string; start:number; end:number }
export interface Result { id:string; kind:'hard'|'style'|'human'; status:'PASS'|'WARN'|'FAIL'|'미평가'; expected:unknown; actual:unknown; offending:Offense[]; message:string }
export interface Inputs { durations:Record<string,number>; transcript:Record<string,Segment[]>; spec?:Spec; style?:Style; errors?:{spec?:string;style?:string;transcript?:string} }
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const inside=(n:number,r:Range)=>n>=r[0]&&n<=r[1];
const offense=(c:Clip,start=c.in,end=c.out):Offense=>({clipId:c.id,source:c.source,start,end});
export function unionSeconds(clips:Clip[]) {
  let sum=0;
  for(const source of new Set(clips.map(c=>c.source))) {
    let end=-Infinity;
    for(const c of clips.filter(c=>c.source===source).sort((a,b)=>a.in-b.in)){sum+=Math.max(0,c.out-Math.max(c.in,end));end=Math.max(end,c.out);}
  }
  return sum;
}
export function evaluate(t:Timeline,input:Inputs):Result[] {
  const {durations,transcript,spec,style}=input,clips=t.clips,results:Result[]=[];
  const add=(id: string,kind:Result['kind'],status:Result['status'],expected:unknown,actual:unknown,offending:Offense[],message:string)=>results.push({id,kind,status,expected,actual,offending,message});
  const missing=(id:string,kind:Result['kind'],message:string)=>add(id,kind,'미평가',null,null,[],message);
  for(const key of ['spec','style'] as const)if(input.errors?.[key])add(`${key}-input`,key==='spec'?'hard':'style',key==='spec'?'FAIL':'WARN','유효한 JSON 사양',input.errors[key],[],'사양을 읽을 수 없습니다');
  const bad=clips.filter(c=>!Number.isFinite(durations[c.source])||c.in<0||c.out<=c.in||c.out>durations[c.source]+.025);
  add('source-bounds','hard',bad.length?'FAIL':'PASS','0 ≤ in < out ≤ 원본 길이',durations,bad.map(c=>offense(c)),bad.length?'원본 범위 또는 파일 확인 필요':'모든 클립이 원본 범위 안입니다');
  const total=clips.reduce((n,c)=>n+c.out-c.in,0),unique=unionSeconds(clips),duplicate=total?Math.max(0,total-unique)/total:0;
  const overlaps=clips.filter((c,i)=>clips.some((d,j)=>i!==j&&c.source===d.source&&Math.min(c.out,d.out)>Math.max(c.in,d.in)));
  add('duplicate-spans','hard',duplicate>.5?'WARN':'PASS','중복 재생 초 / 전체 재생 초 ≤ 0.5',{seconds:total-unique,share:duplicate},overlaps.map(c=>offense(c)),duplicate>.5?'같은 원본 구간의 중복이 50%를 넘습니다':'중복 재생 비율이 허용 범위입니다');
  const target=spec?.targetDuration??style?.targetDuration;
  if(target){const seconds=duration(t);add('duration','hard',inside(seconds,target)?'PASS':'FAIL',target,seconds,inside(seconds,target)?[]:clips.map(c=>offense(c)),'전체 편집 길이 검사');}
  else missing('duration','hard','목표 길이 사양 없음');
  if(spec?.minClipLength!==undefined||spec?.maxClipLength!==undefined){const range:Range=[spec.minClipLength??0,spec.maxClipLength??Infinity],bad=clips.filter(c=>!inside(c.out-c.in,range));add('clip-length','hard',bad.length?'FAIL':'PASS',{min:spec.minClipLength??null,max:spec.maxClipLength??null},clips.map(c=>({clipId:c.id,seconds:c.out-c.in})),bad.map(c=>offense(c)),'개별 클립 최소·최대 길이 검사');}
  else missing('clip-length','hard','클립 길이 사양 없음');
  if(style?.clipLengthMedian&&style.clipLengthIQR&&clips.length){const lengths=clips.map(c=>c.out-c.in).sort((a,b)=>a-b),mid=Math.floor(lengths.length/2),median=lengths.length%2?lengths[mid]:(lengths[mid-1]+lengths[mid])/2;const outside=clips.filter(c=>!inside(c.out-c.in,style.clipLengthIQR!)),share=outside.length/clips.length,medianOK=inside(median,style.clipLengthMedian);add('clip-distribution','style',medianOK&&share<=(style.maxOutsideIQRShare??.5)?'PASS':'WARN',{median:style.clipLengthMedian,iqr:style.clipLengthIQR,maxOutsideShare:style.maxOutsideIQRShare??.5},{median,outsideShare:share},(medianOK?outside:clips).map(c=>offense(c)),'채널 컷 길이 중앙값·IQR 이탈 비율 검사');}
  else missing('clip-distribution','style','채널 중앙값·IQR 기준 또는 클립 없음');
  const cuts:Offense[]=[];
  for(const c of clips)for(const at of [c.in,c.out])if(transcript[c.source]?.some(s=>at-s.start>.5&&s.end-at>.5))cuts.push(offense(c,at,at));
  const transcriptComplete=clips.length>0&&clips.every(c=>!!transcript[c.source]?.length)&&!input.errors?.transcript;
  if(cuts.length)add('transcript-cuts','style','WARN','대본 경계에서 0.5초 이내',{cuts:cuts.length,complete:transcriptComplete},cuts,'문장 중간 컷을 확인하세요');
  else if(transcriptComplete)add('transcript-cuts','style','PASS','대본 경계에서 0.5초 이내',0,[],'대본 중간 컷이 없습니다');
  else missing('transcript-cuts','style','일부 대본이 없거나 읽을 수 없습니다');
  const original=Object.values(durations).reduce((n,d)=>n+d,0);
  if(style?.keepRatio&&original>0&&Object.values(durations).every(Number.isFinite)&&!bad.length)add('keep-ratio','style',inside(unique/original,style.keepRatio)?'PASS':'WARN',style.keepRatio,{ratio:unique/original,uniqueSeconds:unique,originalSeconds:original},inside(unique/original,style.keepRatio)?[]:clips.map(c=>offense(c)),'프로젝트 전체 원본 대비 고유 구간 유지율');
  else missing('keep-ratio','style','유지율 기준 또는 원본 길이 정보 없음');
  for(const key of ['requiredKeywords','forbiddenKeywords'] as const){
    const words=spec?.[key],required=key==='requiredKeywords';
    if(!words?.length){missing(key,'hard','키워드 사양 없음');continue;}
    if(!transcriptComplete){missing(key,'hard','전체 대본이 필요합니다');continue;}
    const texts=clips.map(c=>({c,text:transcript[c.source].filter(s=>s.end>c.in&&s.start<c.out).map(s=>s.text).join(' ').toLocaleLowerCase()}));
    const failed=words.filter(w=>required?!texts.some(x=>x.text.includes(w.toLocaleLowerCase())):texts.some(x=>x.text.includes(w.toLocaleLowerCase())));
    add(key,'hard',failed.length?'FAIL':'PASS',words,{unmet:failed},required?[]:texts.filter(x=>failed.some(w=>x.text.includes(w.toLocaleLowerCase()))).map(x=>offense(x.c)),required?'필수 키워드 포함 검사':'금지 키워드 제외 검사');
  }
  missing('creative-review','human','유머 타이밍/채널다움 · 창작자 확인 필요');
  return results;
}
export function summary(results:Result[]) {const count=(s:Result['status'])=>results.filter(r=>r.status===s).length;return `검증 ${count('PASS')}/${results.length-count('미평가')} 통과 · 경고 ${count('WARN')} · 실패 ${count('FAIL')} · 미평가 ${count('미평가')}`;}
export const hardFailures=(results:Result[])=>results.some(r=>r.kind==='hard'&&r.status==='FAIL');
export function parseSettings(text:string,type:'spec'|'style'):Spec&Style {
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('사양은 JSON 객체여야 합니다');
  const allowed=type==='spec'?['version','targetDuration','minClipLength','maxClipLength','requiredKeywords','forbiddenKeywords']:['version','targetDuration','clipLengthMedian','clipLengthIQR','maxOutsideIQRShare','keepRatio'];
  for(const key of Object.keys(value)){
    const v=value[key];if(!allowed.includes(key))throw Error(`알 수 없는 사양: ${key}`);
    if(['targetDuration','clipLengthMedian','clipLengthIQR','keepRatio'].includes(key)){if(!Array.isArray(v)||v.length!==2||v.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)||v[0]>v[1]||(key==='keepRatio'&&v[1]>1))throw Error(`잘못된 범위: ${key}`);}
    else if(key==='version'){if(typeof v!=='string')throw Error('version은 문자열');}
    else if(key.endsWith('Keywords')){if(!Array.isArray(v)||v.some(w=>typeof w!=='string'||!w.trim()))throw Error(`잘못된 키워드: ${key}`);}
    else if(typeof v!=='number'||!Number.isFinite(v)||v<0||(key==='maxOutsideIQRShare'&&v>1))throw Error(`잘못된 수치: ${key}`);
  }
  if(value.minClipLength>value.maxClipLength)throw Error('최소 클립 길이가 최대보다 큽니다');
  return value;
}
async function optional(file:string){try{return await fs.readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
export async function checkProject(root:string,t:Timeline){
  const input:Inputs={durations:{},transcript:{},errors:{}},versions:Record<string,unknown>={};
  for(const key of ['spec','style'] as const){
    try{const raw=await optional(path.join(root,key==='spec'?'edit-spec.json':'style.md'));versions[key]={sha256:raw===undefined?null:hash(raw),version:null};
      const blocks=key==='style'?[...(raw??'').matchAll(/^```cutline-style\s*\r?\n([\s\S]*?)^```\s*$/gm)]:[];
      if(blocks.length>1)throw Error('cutline-style 블록은 하나만 허용됩니다');
      const json=key==='spec'?raw:blocks[0]?.[1];if(json!==undefined){input[key]=parseSettings(json,key);versions[key]={sha256:hash(raw!),version:input[key]?.version??null};}
    }catch(e){input.errors![key]=String(e);}
  }
  try{input.transcript=await transcripts(root);}catch(e){input.errors!.transcript=String(e);}
  const sources=new Set(t.clips.map(c=>c.source));
  async function walk(dir:string){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await walk(file);else if(item.isFile()&&/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(item.name))sources.add(path.relative(root,file).replace(/\\/g,'/'));}}
  try{await walk(path.join(root,'sources'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  for(const source of sources){try{input.durations[source]=(await probe(await sourcePath(root,source))).duration;}catch{input.durations[source]=NaN;}}
  const results=evaluate(t,input);
  return {version:1,engineVersion:'cutline-check-1',timelineHash:hash(JSON.stringify(t)),versions,results,summary:summary(results)};
}
