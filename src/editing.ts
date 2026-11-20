import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Timeline,validate,readTimeline,writeTimeline} from './core';
import * as history from './history';
import {sequenceModel} from './sequence';
export const same=(a:Timeline,b:Timeline)=>JSON.stringify(a)===JSON.stringify(b);
export async function logEdit(root:string,who:'human'|'agent',action:string,before:Timeline,after:Timeline){
  if(same(before,after))return;
  const ids=[...new Set([...before.clips,...after.clips].map(c=>c.id))].filter(id=>JSON.stringify(before.clips.find(c=>c.id===id))!==JSON.stringify(after.clips.find(c=>c.id===id))||before.clips.findIndex(c=>c.id===id)!==after.clips.findIndex(c=>c.id===id));
  if(before.sequence||after.sequence){const a=sequenceModel.fromTimeline(before),b=sequenceModel.fromTimeline(after);for(const id of new Set([...a.items,...b.items].map(c=>c.id))){const x=a.items.find(c=>c.id===id),y=b.items.find(c=>c.id===id);if(JSON.stringify(x)!==JSON.stringify(y)||JSON.stringify(a.tracks.find(t=>t.id===x?.trackId))!==JSON.stringify(b.tracks.find(t=>t.id===y?.trackId)))if(!ids.includes(id))ids.push(id);}}
  await fs.mkdir(path.join(root,'.cutline'),{recursive:true});
  await fs.appendFile(path.join(root,'.cutline/edit-log.jsonl'),JSON.stringify({at:new Date().toISOString(),who,action,clipIds:ids,before,after})+'\n');
}
export async function recordAgentEdit(root:string,prompt:string,before:Timeline,after:Timeline,autoCommit:boolean){
  if(same(before,after))return false;
  await logEdit(root,'agent','prompt: '+prompt,before,after);
  if(autoCommit)await history.commit(root,'agent: '+prompt.split(/\r?\n/)[0].slice(0,200));
  return true;
}
export type ManualAction={action:'split'|'delete'|'trim'|'undo'|'redo'|'sequence';id?:string;at?:number;in?:number;out?:number;operation?:any};
export function manualEdit(t:Timeline,m:ManualAction):Timeline{
  if(m.action==='sequence')return validate(sequenceModel.toTimeline(t,sequenceModel.operate(sequenceModel.fromTimeline(t),m.operation)));
  if(t.sequence){const seq=sequenceModel.fromTimeline(t),item=seq.items.find(c=>c.id===m.id);if(!item)throw Error('클립을 선택하세요');
    const operation=m.action==='trim'?{action:'properties',ids:[item.id],patch:{in:m.in,out:m.out}}:{action:m.action,ids:[item.id],time:item.start+(m.at??item.in)-item.in,linked:true};
    return validate(sequenceModel.toTimeline(t,sequenceModel.operate(seq,operation)));}
  const next=structuredClone(t),i=next.clips.findIndex(c=>c.id===m.id),c=next.clips[i];if(!c)throw Error('클립을 선택하세요');
  if(m.action==='delete')next.clips.splice(i,1);
  else if(m.action==='split'){if(!Number.isFinite(m.at)||m.at!<=c.in||m.at!>=c.out)throw Error('클립 내부에 재생 헤드를 놓으세요');next.clips.splice(i+1,0,{...c,id:'split-'+randomUUID(),in:m.at!});c.out=m.at!;}
  else if(m.action==='trim'){c.in=m.in!;c.out=m.out!;}
  else throw Error('Unknown edit');return validate(next);
}
export class EditSession {
  private undoStack:{before:Timeline;after:Timeline}[]=[];private redoStack:{before:Timeline;after:Timeline}[]=[];
  clear(){this.undoStack=[];this.redoStack=[];}
  get state(){return {undo:!!this.undoStack.length,redo:!!this.redoStack.length};}
  async apply(root:string,m:ManualAction,check:(t:Timeline)=>Promise<unknown>){
    const before=await readTimeline(root),undo=m.action==='undo',redo=m.action==='redo';
    const entry=(undo?this.undoStack:this.redoStack).at(-1);
    let after:Timeline;
    if(undo||redo){if(!entry)throw Error('되돌릴 편집이 없습니다');if(!same(before,undo?entry.after:entry.before)){this.clear();throw Error('외부 편집 후에는 이전 수동 편집을 되돌릴 수 없습니다');}after=structuredClone(undo?entry.before:entry.after);}
    else after=manualEdit(before,m);
    if(same(before,after))return;
    await check(after);
    if(!same(before,await readTimeline(root))){this.clear();throw Error('검증 중 외부 편집이 감지되었습니다. 최신 화면에서 다시 편집하세요');}
    await writeTimeline(root,after);
    if(undo){this.undoStack.pop();this.redoStack.push(entry!);}else if(redo){this.redoStack.pop();this.undoStack.push(entry!);}else{this.undoStack.push({before,after});this.redoStack=[];}
    await logEdit(root,'human',m.action==='sequence'?'sequence:'+m.operation?.action:m.action,before,after);
  }
}
