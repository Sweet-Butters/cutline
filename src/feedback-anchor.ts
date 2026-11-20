/** Source-time anchors. No nearest-time or first-candidate fallback is allowed. */
import {createHash} from 'node:crypto';
import {Timeline,validate,duration} from './core';
import {sequenceModel} from './sequence';

export interface Placement {id:string;source:string;kind:'video'|'audio';trackId:string;start:number;in:number;out:number;visible:boolean}
export interface AnchorSpan {clipId:string;source:string;sourceHash:string;kind:'video'|'audio';trackId:string;sourceStart:number;sourceEnd?:number}
export interface FeedbackAnchor {versionId:string;start:number;end?:number;spans:AnchorSpan[];versionOnly?:boolean}
export interface ResolvedSegment {clipId:string;source:string;start:number;end?:number}
export type AnchorResolution={state:'linked';start:number;end?:number;segments:ResolvedSegment[];method:'same-version'|'clip-and-source'|'source-time'|'manual'}|{state:'needs_review';reason:'missing'|'ambiguous'|'discontinuous'|'version_only';message:string};
export type SourceHashes=Record<string,string|undefined>;
const EPS=1e-6;
export function canonical(value:any):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export function timelineId(t:Timeline){return createHash('sha256').update(canonical(validate(structuredClone(t)))).digest('hex');}
export function placements(t:Timeline):Placement[]{
  if(t.sequence){const seq=sequenceModel.fromTimeline(t);return seq.items.filter(c=>(c.kind==='video'||c.kind==='audio')&&c.source).map(c=>({id:c.id,source:c.source!,kind:c.kind as 'video'|'audio',trackId:c.trackId,start:c.start,in:c.in,out:c.out,visible:seq.tracks.find(x=>x.id===c.trackId)?.visible!==false}));}
  let start=0;return t.clips.map(c=>{const p={id:c.id,source:c.source,kind:'video' as const,trackId:'V1',start,in:c.in,out:c.out,visible:true};start+=c.out-c.in;return p;});
}
function span(p:Placement,start:number,end:number|undefined,hashes:SourceHashes):AnchorSpan{
  const sourceHash=hashes[p.source];if(!sourceHash)throw Error('원본 파일을 확인할 수 없어 위치를 저장하지 못했습니다.');
  return {clipId:p.id,source:p.source,sourceHash,kind:p.kind,trackId:p.trackId,sourceStart:p.in+start-p.start,...(end===undefined?{}:{sourceEnd:p.in+end-p.start})};
}
export function captureAnchor(t:Timeline,start:number,end:number|undefined,hashes:SourceHashes,clipId?:string):FeedbackAnchor{
  const length=duration(t);
  if(!Number.isFinite(start)||start<0||start>=length||end!==undefined&&(!Number.isFinite(end)||end<=start||end>length+EPS))throw Error('영상 안의 시점 또는 올바른 구간을 지정하세요. 끝 경계에는 장면이 없습니다.');
  const all=placements(t),video=all.filter(c=>c.kind==='video'&&c.visible),chosen=clipId?all.find(c=>c.id===clipId):undefined;
  if(clipId&&!chosen)throw Error('선택한 클립이 현재 버전에 없습니다.');
  const anchor:FeedbackAnchor={versionId:timelineId(t),start,...(end===undefined?{}:{end}),spans:[]};
  if(chosen){if(start<chosen.start-EPS||start>=chosen.start+chosen.out-chosen.in||end!==undefined&&end>chosen.start+chosen.out-chosen.in+EPS)throw Error('지정 구간이 선택한 클립 밖에 있습니다. 여러 클립 구간은 자동 대상을 선택하세요.');anchor.spans=[span(chosen,start,end,hashes)];return anchor;}
  let cursor=start;
  for(let i=0;i<=all.length*2+1;i++){
    const active=video.filter(c=>c.start<=cursor+EPS&&c.start+c.out-c.in>cursor+EPS);
    if(active.length>1)throw Error('겹치는 영상이 있습니다. 댓글의 대상 클립을 직접 선택하세요.');
    if(!active.length){anchor.spans=[];anchor.versionOnly=true;return anchor;}
    const p=active[0];
    if(end===undefined){anchor.spans=[span(p,start,undefined,hashes)];return anchor;}
    const stop=Math.min(end,p.start+p.out-p.in,...video.filter(c=>c.start>cursor+EPS).map(c=>c.start));
    anchor.spans.push(span(p,cursor,stop,hashes));cursor=stop;
    if(cursor>=end-EPS)return anchor;
  }
  throw Error('구간의 위치를 확인할 수 없습니다.');
}
const missing=():AnchorResolution=>({state:'needs_review',reason:'missing',message:'원본 장면이 삭제·트림되었거나 원본 파일이 달라졌습니다.'});
const ambiguous=():AnchorResolution=>({state:'needs_review',reason:'ambiguous',message:'동일한 원본 장면이 여러 곳에 있어 위치 확인이 필요합니다.'});
export function resolveAnchor(anchor:FeedbackAnchor,target:Timeline,hashes:SourceHashes):AnchorResolution{
  const same=anchor.versionId===timelineId(target),all=placements(target),segments:ResolvedSegment[]=[];
  if(anchor.versionOnly||!anchor.spans.length)return same?{state:'linked',start:anchor.start,...(anchor.end===undefined?{}:{end:anchor.end}),segments:[],method:'same-version'}:{state:'needs_review',reason:'version_only',message:'이 의견은 원본 장면이 없는 위치에 작성됐습니다. 새 버전에 직접 연결하세요.'};
  let usedSourceOnly=false;
  for(const s of anchor.spans){
    const related=all.filter(p=>p.kind===s.kind&&hashes[p.source]===s.sourceHash);
    let source=s.sourceStart;
    for(let step=0;step<=all.length+1;step++){
      const candidates=related.filter(p=>source>=p.in-EPS&&source<p.out-EPS);
      const exact=candidates.filter(p=>p.id===s.clipId);
      if(!candidates.length)return missing();
      if(exact.length>1||!exact.length&&candidates.length>1)return ambiguous();
      const p=exact[0]||candidates[0];if(!exact.length)usedSourceOnly=true;
      const start=p.start+source-p.in;
      if(s.sourceEnd===undefined){segments.push({clipId:p.id,source:p.source,start});break;}
      const stop=Math.min(s.sourceEnd,p.out,...(!exact.length?related.filter(x=>x.in>source+EPS).map(x=>x.in):[]));segments.push({clipId:p.id,source:p.source,start,end:p.start+stop-p.in});source=stop;
      if(source>=s.sourceEnd-EPS)break;
      if(step===all.length+1)return missing();
    }
  }
  if(!segments.length)return missing();
  for(let i=1;i<segments.length;i++)if(segments[i-1].end===undefined||Math.abs(segments[i].start-segments[i-1].end!)>EPS)return {state:'needs_review',reason:'discontinuous',message:'구간이 나뉘거나 순서가 바뀌었습니다. 재생할 구간을 직접 확인해 다시 연결하세요.'};
  return {state:'linked',start:segments[0].start,...(anchor.end===undefined?{}:{end:segments.at(-1)!.end}),segments,method:same?'same-version':usedSourceOnly?'source-time':'clip-and-source'};
}
