/** The same operations and constraints run in the host and in the webview. */
export interface SequenceTrack { id:string; name:string; kind:'video'|'audio'|'caption'; order:number; height:number; locked?:boolean; visible?:boolean; muted?:boolean; solo?:boolean; gainDb?:number; targeted?:boolean; sourceTarget?:boolean }
export interface SequenceItem { id:string; kind:'video'|'audio'|'text'|'shape'; trackId:string; start:number; in:number; out:number; source?:string; name?:string; reason?:string; linkGroup?:string; gainDb?:number; automation?:{time:number;db:number}[]; opacityAutomation?:{time:number;value:number}[];text?:string; style?:{x?:number;y?:number;width?:number;height?:number;color?:string;fontSize?:number;opacity?:number}; effects?:{opacity?:number;brightness?:number} }
export interface Sequence { version:1; name:string; fps:number; mixDb:number; tracks:SequenceTrack[]; items:SequenceItem[]; markers:{id:string;time:number;label:string}[]; legacy?:string }
const model = require('../media/sequence-model.js');
export const sequenceModel: {
  fromTimeline(t:unknown):Sequence; toTimeline(t:unknown,s:Sequence):any; validate(s:unknown):Sequence;
  operate(s:Sequence,operation:any):Sequence; assertLocks(a:Sequence,b:Sequence):void;
  duration(s:Sequence):number; end(c:SequenceItem):number; volumeAt(c:SequenceItem,time:number):number;
  audible(s:Sequence,t:SequenceTrack):boolean;
} = model;
