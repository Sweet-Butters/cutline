import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Timeline,validate,sourcePath,duration} from './core';
import {run} from './media';
import * as history from './history';
import {AnchorResolution,FeedbackAnchor,SourceHashes,captureAnchor,placements,resolveAnchor,timelineId} from './feedback-anchor';

export const FEEDBACK_STATUSES=['수정 요청','편집 중','수정 완료','편집 완료','보류','검토 완료'] as const;
export type FeedbackStatus=typeof FEEDBACK_STATUSES[number];
export interface FeedbackAuthor {id:string;name:string;role:'편집자'|'편집 제안자'}
export interface GitReference {hash:string;message:string;date?:string}
export interface FeedbackVersion {id:string;createdAt:string;duration:number;git:GitReference[];number?:number}
export interface AnchorEntry {id:string;anchor:FeedbackAnchor;author:FeedbackAuthor;at:string;note:string}
export interface FeedbackReply {id:string;parentId?:string;body:string;author:FeedbackAuthor;at:string}
export interface FeedbackEvent {id:string;type:'created'|'status'|'relinked'|'edited';at:string;author:FeedbackAuthor;from?:FeedbackStatus;to?:FeedbackStatus;note?:string;anchorId?:string}
export interface FeedbackThread {id:string;body:string;author:FeedbackAuthor;createdAt:string;updatedAt:string;editedAt?:string;status:FeedbackStatus;anchors:AnchorEntry[];replies:FeedbackReply[];events:FeedbackEvent[]}
export interface FeedbackData {schemaVersion:1;revision:number;profile:FeedbackAuthor;versions:Record<string,FeedbackVersion>;threads:FeedbackThread[];requests:string[]}
export interface FeedbackMutation {action:'create'|'reply'|'status'|'relink'|'profile'|'delete'|'edit';requestId:string;expectedRevision:number;threadId?:string;parentId?:string;body?:string;status?:FeedbackStatus;start?:number;end?:number;clipId?:string;name?:string;role?:FeedbackAuthor['role'];note?:string;versionId?:string}
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const id=(s:unknown):s is string=>typeof s==='string'&&/^[\w-]{1,100}$/.test(s);
const text=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const status=(s:unknown):s is FeedbackStatus=>FEEDBACK_STATUSES.includes(s as FeedbackStatus);
const author=(a:FeedbackAuthor)=>a&&id(a.id)&&text(a.name,60)&&['편집자','편집 제안자'].includes(a.role);
export class FeedbackConflict extends Error {constructor(){super('다른 창에서 피드백이 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장하세요.');}}
export class FeedbackLocationError extends Error {constructor(public resolution:AnchorResolution){super(resolution.state==='needs_review'?resolution.message:'위치를 확인하세요.');}}
export function validateFeedback(value:unknown):FeedbackData{
  const d=value as FeedbackData;
  if(!d||d.schemaVersion!==1||!Number.isSafeInteger(d.revision)||d.revision<0||!author(d.profile)||!d.versions||Array.isArray(d.versions)||!Array.isArray(d.threads)||!Array.isArray(d.requests)||d.requests.some(x=>!id(x)))throw Error('피드백 저장 형식이 올바르지 않습니다. 기존 파일은 보존했습니다.');
  const numbers=new Set<number>();
  for(const [key,v] of Object.entries(d.versions)){
    if(!hex(key)||key!==v.id||!Number.isFinite(v.duration)||v.duration<0||!Array.isArray(v.git)||v.git.some(g=>!/^[a-f0-9]{40}$/.test(g.hash)||typeof g.message!=='string'))throw Error('피드백 버전 기록이 올바르지 않습니다.');
    if(v.number!==undefined){if(!Number.isSafeInteger(v.number)||v.number<1||numbers.has(v.number))throw Error('피드백 버전 번호가 올바르지 않습니다.');numbers.add(v.number);}
  }
  const threadIds=new Set<string>();
  for(const t of d.threads){
    if(!id(t.id)||threadIds.has(t.id)||!text(t.body,5000)||!author(t.author)||!status(t.status)||!Array.isArray(t.anchors)||!t.anchors.length||!Array.isArray(t.replies)||!Array.isArray(t.events))throw Error('피드백 스레드가 올바르지 않습니다.');
    threadIds.add(t.id);
    if(t.editedAt!==undefined&&(typeof t.editedAt!=='string'||!Number.isFinite(Date.parse(t.editedAt))))throw Error('댓글 수정 시각이 올바르지 않습니다.');
    for(const entry of t.anchors){
      const a=entry.anchor;
      if(!id(entry.id)||!author(entry.author)||!a||!hex(a.versionId)||!d.versions[a.versionId]||!Number.isFinite(a.start)||a.start<0||a.end!==undefined&&(!Number.isFinite(a.end)||a.end<=a.start)||!Array.isArray(a.spans))throw Error('피드백 위치 기록이 올바르지 않습니다.');
      for(const s of a.spans)if(!id(s.clipId)||!hex(s.sourceHash)||typeof s.source!=='string'||!s.source.startsWith('sources/')||!['video','audio'].includes(s.kind)||!Number.isFinite(s.sourceStart)||s.sourceStart<0||s.sourceEnd!==undefined&&(!Number.isFinite(s.sourceEnd)||s.sourceEnd<=s.sourceStart))throw Error('원본 시각 기록이 올바르지 않습니다.');
    }
    const replyIds=new Set<string>();
    for(const r of t.replies){if(!id(r.id)||replyIds.has(r.id)||!text(r.body,5000)||!author(r.author)||r.parentId!==undefined&&!replyIds.has(r.parentId))throw Error('답글 연결이 올바르지 않습니다.');replyIds.add(r.id);}
    for(const e of t.events)if(!id(e.id)||!author(e.author)||!['created','status','relinked','edited'].includes(e.type)||e.from!==undefined&&!status(e.from)||e.to!==undefined&&!status(e.to))throw Error('상태 변경 이력이 올바르지 않습니다.');
  }
  return d;
}
const fresh=():FeedbackData=>({schemaVersion:1,revision:0,profile:{id:randomUUID(),name:'나',role:'편집자'},versions:{},threads:[],requests:[]});

/** Atomic local storage. Shared filesystem locks also protect two editor windows. */
export class FeedbackStore {
  readonly directory:string;private file:string;private queue:Promise<unknown>=Promise.resolve();
  private hashes=new Map<string,{signature:string;hash:string}>();
  private gitCache?:{head:string;items:GitReference[]};
  constructor(readonly root:string){this.directory=path.join(root,'.cutline','feedback');this.file=path.join(this.directory,'state.json');}
  private async directories(){
    for(const dir of [path.join(this.root,'.cutline'),this.directory,path.join(this.directory,'snapshots')]){
      await fs.mkdir(dir,{recursive:true});const info=await fs.lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw Error('피드백 저장 위치는 프로젝트 안의 일반 폴더여야 합니다.');
    }
  }
  private async read():Promise<FeedbackData>{
    try{const info=await fs.lstat(this.file);if(!info.isFile()||info.isSymbolicLink())throw Error('피드백 파일은 일반 파일이어야 합니다.');return validateFeedback(JSON.parse(await fs.readFile(this.file,'utf8')));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fresh();if(error instanceof SyntaxError)throw Error('피드백 JSON을 읽을 수 없습니다. 기존 파일을 보존했습니다.');throw error;}
  }
  private async atomic(file:string,value:unknown){
    const temp=file+'.'+randomUUID()+'.tmp';let handle:fs.FileHandle|undefined;
    try{handle=await fs.open(temp,'wx');await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();await handle.close();handle=undefined;await fs.rename(temp,file);}finally{await handle?.close();await fs.rm(temp,{force:true});}
  }
  private transact<T>(fn:(data:FeedbackData)=>Promise<{result:T;changed:boolean}>):Promise<T>{
    const job=this.queue.catch(()=>{}).then(async()=>{
      await this.directories();const lock=path.join(this.directory,'write.lock'),nonce=randomUUID();let handle:fs.FileHandle|undefined;const deadline=Date.now()+5000;
      while(!handle){
        try{handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,nonce}));}
        catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
          try{const data=JSON.parse(await fs.readFile(lock,'utf8'));if(Number.isInteger(data.pid)&&data.pid>0){try{process.kill(data.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')await fs.rm(lock,{force:true});}}}catch{}
          if(Date.now()>deadline)throw Error('다른 창에서 피드백을 저장 중입니다. 잠시 후 다시 시도하세요.');await new Promise(r=>setTimeout(r,30));
        }
      }
      try{const data=await this.read(),{result,changed}=await fn(data);if(changed){data.revision++;validateFeedback(data);await this.atomic(this.file,data);}return result;}
      finally{await handle.close();try{const own=JSON.parse(await fs.readFile(lock,'utf8'));if(own.nonce===nonce)await fs.rm(lock,{force:true});}catch{}}
    });this.queue=job;return job;
  }
  async sourceHashes(t:Timeline):Promise<SourceHashes>{
    const result:SourceHashes={};
    for(const source of new Set(placements(t).map(p=>p.source))){
      try{
        const file=await sourcePath(this.root,source),before=await fs.stat(file),signature=[before.size,before.mtimeMs,before.ctimeMs,before.ino].join(':');
        const cached=this.hashes.get(file);if(cached?.signature===signature){result[source]=cached.hash;continue;}
        const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
        const after=await fs.stat(file);if([after.size,after.mtimeMs,after.ctimeMs,after.ino].join(':')!==signature)continue;
        const value=hash.digest('hex');this.hashes.set(file,{signature,hash:value});result[source]=value;
      }catch{result[source]=undefined;}
    }
    return result;
  }
  private async gitReference(t:Timeline,hint?:string):Promise<GitReference|undefined>{
    try{
      const head=(await run('git',['rev-parse','--verify','HEAD'],this.root)).trim();
      if(this.gitCache?.head!==head)this.gitCache={head,items:await history.versions(this.root)};
      const ref=hint?this.gitCache.items.find(x=>x.hash===hint)||{hash:hint,message:'Git 편집 버전'}:this.gitCache.items[0];
      if(ref&&timelineId(await history.version(this.root,ref.hash))===timelineId(t))return ref;
    }catch{}return undefined;
  }
  async observe(t:Timeline,gitHint?:string):Promise<FeedbackVersion>{
    t=validate(structuredClone(t));const key=timelineId(t),git=await this.gitReference(t,gitHint);
    return this.transact(async data=>{
      let changed=false,v=data.versions[key];
      const versions=Object.values(data.versions);let next=versions.reduce((max,item)=>Math.max(max,item.number??0),0);
      // Assign legacy records once, in the order they were first observed.
      for(const item of versions.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))if(item.number===undefined){item.number=++next;changed=true;}
      if(!v){v={id:key,createdAt:new Date().toISOString(),duration:duration(t),git:[],number:++next};
        const file=path.join(this.directory,'snapshots',key+'.json');
        try{const existing=validate(JSON.parse(await fs.readFile(file,'utf8')));if(timelineId(existing)!==key)throw Error('기존 피드백 스냅샷이 손상되었습니다.');}
        catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')await this.atomic(file,t);else throw e;}
        data.versions[key]=v;changed=true;
      }
      if(git&&!v.git.some(g=>g.hash===git.hash)){v.git.push(git);changed=true;}
      return {result:structuredClone(v),changed};
    });
  }
  async snapshot(key:string):Promise<Timeline>{
    if(!hex(key))throw Error('잘못된 피드백 버전입니다.');const data=await this.read();if(!data.versions[key])throw Error('저장된 편집 버전을 찾을 수 없습니다.');
    const file=path.join(this.directory,'snapshots',key+'.json'),info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('올바른 버전 스냅샷이 아닙니다.');
    const t=validate(JSON.parse(await fs.readFile(file,'utf8')));if(timelineId(t)!==key)throw Error('버전 스냅샷이 변경되어 재생을 차단했습니다.');return t;
  }
  async view(t:Timeline,gitHint?:string){
    const viewed=await this.observe(t,gitHint),data=await this.read(),hashes=data.threads.length?await this.sourceHashes(t):{};
    return {schemaVersion:1,mode:'local' as const,revision:data.revision,profile:data.profile,viewVersion:data.versions[viewed.id],versions:Object.values(data.versions),statuses:FEEDBACK_STATUSES,
      threads:data.threads.map(thread=>{const original=thread.anchors[0],latest=thread.anchors.at(-1)!;const anchor=[...thread.anchors].reverse().find(a=>a.anchor.versionId===viewed.id)||latest;const resolution=resolveAnchor(anchor.anchor,t,hashes);if(resolution.state==='linked'&&anchor!==original)resolution.method='manual';return {...thread,resolution,activeAnchorId:anchor.id};})};
  }
  async mutate(input:FeedbackMutation,t:Timeline,gitHint?:string){
    if(!id(input.requestId)||!Number.isSafeInteger(input.expectedRevision))throw Error('올바른 피드백 요청이 아닙니다.');
    if(input.action==='create'||input.action==='relink'){
      if(input.versionId!==timelineId(t))throw Error('편집 버전이 변경되었습니다. 위치를 다시 지정하세요.');await this.observe(t,gitHint);
    }
    const hashes=['create','relink'].includes(input.action)?await this.sourceHashes(t):{};
    await this.transact(async data=>{
      if(data.requests.includes(input.requestId))return {result:null,changed:false};
      if(input.expectedRevision!==data.revision)throw new FeedbackConflict();
      const now=new Date().toISOString(),by=structuredClone(data.profile),eventId=randomUUID();
      if(input.action==='profile'){
        if(!text(input.name,60)||!['편집자','편집 제안자'].includes(input.role!))throw Error('이름과 역할을 입력하세요.');data.profile={...by,name:input.name!.trim(),role:input.role!};
      }else if(input.action==='create'){
        if(!text(input.body,5000)||!status(input.status))throw Error('댓글과 상태를 확인하세요.');if(data.threads.length>=2000)throw Error('프로젝트의 피드백 스레드가 너무 많습니다.');
        const anchor=captureAnchor(t,input.start!,input.end,hashes,input.clipId),entry:AnchorEntry={id:randomUUID(),anchor,author:by,at:now,note:'작성 시 위치'};
        data.threads.push({id:randomUUID(),body:input.body!.trim(),author:by,createdAt:now,updatedAt:now,status:input.status,anchors:[entry],replies:[],events:[{id:eventId,type:'created',at:now,author:by,to:input.status,anchorId:entry.id}]});
      }else if(input.action==='delete'){
        const index=data.threads.findIndex(thread=>thread.id===input.threadId);
        if(index<0)throw Error('피드백 스레드를 찾을 수 없습니다.');
        data.threads.splice(index,1);
      }else{
        const thread=data.threads.find(x=>x.id===input.threadId);if(!thread)throw Error('피드백 스레드를 찾을 수 없습니다.');
        if(input.action==='reply'){
          if(!text(input.body,5000)||input.parentId&&!thread.replies.some(r=>r.id===input.parentId))throw Error('답글 내용과 대상을 확인하세요.');if(thread.replies.length>=500)throw Error('이 스레드에 답글을 더 추가할 수 없습니다.');
          thread.replies.push({id:randomUUID(),...(input.parentId?{parentId:input.parentId}:{}),body:input.body!.trim(),author:by,at:now});
        }else if(input.action==='edit'){
          if(!text(input.body,5000))throw Error('댓글은 1~5000자로 입력하세요.');
          const body=input.body!.trim();if(body===thread.body)return {result:null,changed:false};
          thread.body=body;thread.editedAt=now;thread.events.push({id:eventId,type:'edited',at:now,author:by});
        }else if(input.action==='status'){
          if(!status(input.status))throw Error('지원하지 않는 상태입니다.');if(thread.status===input.status)return {result:null,changed:false};
          thread.events.push({id:eventId,type:'status',at:now,author:by,from:thread.status,to:input.status});thread.status=input.status;
        }else if(input.action==='relink'){
          if(!text(input.note,1000))throw Error('다시 연결하는 이유를 입력하세요.');
          const entry:AnchorEntry={id:randomUUID(),anchor:captureAnchor(t,input.start!,input.end,hashes,input.clipId),author:by,at:now,note:input.note!.trim()};thread.anchors.push(entry);thread.events.push({id:eventId,type:'relinked',at:now,author:by,note:entry.note,anchorId:entry.id});
        }else throw Error('지원하지 않는 피드백 작업입니다.');thread.updatedAt=now;
      }
      data.requests.push(input.requestId);data.requests=data.requests.slice(-2048);return {result:null,changed:true};
    });
    return this.view(t,gitHint);
  }
  async navigation(threadId:string,target:Timeline,original=false){
    const data=await this.read(),thread=data.threads.find(t=>t.id===threadId);if(!thread)throw Error('피드백 스레드가 없습니다.');
    const anchor=original?thread.anchors[0]:[...thread.anchors].reverse().find(a=>a.anchor.versionId===timelineId(target))||thread.anchors.at(-1)!;
    const resolution=resolveAnchor(anchor.anchor,target,await this.sourceHashes(target));if(resolution.state!=='linked')throw new FeedbackLocationError(resolution);
    return {versionId:timelineId(target),resolution,originalVersion:thread.anchors[0].anchor.versionId};
  }
  async originalVersion(threadId:string){const t=(await this.read()).threads.find(t=>t.id===threadId);if(!t)throw Error('스레드가 없습니다.');return t.anchors[0].anchor.versionId;}
  async versionInfo(key:string){const version=(await this.read()).versions[key];if(!version)throw Error('피드백 버전을 찾을 수 없습니다.');return structuredClone(version);}
}
