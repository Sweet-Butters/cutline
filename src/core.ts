import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {Sequence,sequenceModel} from './sequence';

export interface Clip { id: string; source: string; in: number; out: number; reason?: string }
export interface Timeline { version: 1; clips: Clip[]; sequence?:Sequence }
export interface Segment { start: number; end: number; text: string }
export interface Diff { added: Clip[]; removed: Clip[]; trimmed: Clip[]; moved: string[]; changed: string[]; before: number; after: number }
export const duration = (t: Timeline) => t.sequence ? sequenceModel.duration(sequenceModel.fromTimeline(t)) : t.clips.reduce((n,c) => n + c.out - c.in, 0);
export function validate(value: unknown): Timeline {
  const t = value as Timeline;
  if (!t || t.version !== 1 || !Array.isArray(t.clips)) throw Error('Expected {version:1, clips:[]}');
  const ids = new Set<string>();
  for (const c of t.clips) {
    if (!c || typeof c.id !== 'string' || !/^[\w-]{1,80}$/.test(c.id) || ids.has(c.id)) throw Error('Clip ids must be unique (letters, digits, _, -; 1–80 characters)');
    ids.add(c.id);
    if (typeof c.source !== 'string' || !c.source.startsWith('sources/') || c.source.includes('\\') || c.source.split('/').some(s => !s || s === '..' || s === '.') || /[:\x00-\x1f]/.test(c.source)) throw Error(`${c.id}: source must be a relative sources/ path with forward slashes`);
    if (typeof c.in !== 'number' || typeof c.out !== 'number' || !Number.isFinite(c.in) || !Number.isFinite(c.out) || c.in < 0 || c.out <= c.in) throw Error(`${c.id}: require finite 0 <= in < out`);
    if (c.reason !== undefined && (typeof c.reason !== 'string' || c.reason.length > 1000)) throw Error(`${c.id}: reason must be a short string`);
  }
  if(t.sequence){sequenceModel.validate(t.sequence);t.sequence=sequenceModel.fromTimeline(t);}
  return t;
}
export async function sourcePath(root: string, source: string): Promise<string> {
  const base = await fs.realpath(path.join(root, 'sources'));
  const file = await fs.realpath(path.join(root, source));
  const rel = path.relative(base, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !(await fs.stat(file)).isFile()) throw Error(`Source escapes sources/ or is not a file: ${source}`);
  return file;
}
export async function readTimeline(root: string) { return validate(JSON.parse(await fs.readFile(path.join(root,'timeline.json'),'utf8'))); }
export async function writeTimeline(root: string, t: Timeline) {
  validate(t);
  const temp = path.join(root, `.timeline-${process.pid}-${Date.now()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(t,null,2)+'\n');
  try { await fs.rename(temp,path.join(root,'timeline.json')); } finally { await fs.rm(temp,{force:true}); }
}
export function diffTimeline(a: Timeline, b: Timeline): Diff {
  const old = new Map(a.clips.map(c=>[c.id,c])), next = new Map(b.clips.map(c=>[c.id,c]));
  const commonA = a.clips.filter(c=>next.has(c.id)).map(c=>c.id);
  const commonB = b.clips.filter(c=>old.has(c.id)).map(c=>c.id);
  return {added:b.clips.filter(c=>!old.has(c.id)),removed:a.clips.filter(c=>!next.has(c.id)),
    trimmed:b.clips.filter(c=>{const p=old.get(c.id);return p && (p.in!==c.in || p.out!==c.out || p.source!==c.source);}),
    moved:commonB.filter((id,i)=>commonA[i]!==id), changed:b.clips.filter(c=>old.has(c.id)&&old.get(c.id)!.reason!==c.reason).map(c=>c.id),before:duration(a),after:duration(b)};
}
export async function transcripts(root: string): Promise<Record<string,Segment[]>> {
  const result: Record<string,Segment[]> = {};
  const dir = path.join(root,'transcripts');
  async function walk(folder: string) {
    for (const item of await fs.readdir(folder,{withFileTypes:true})) {
      const file = path.join(folder,item.name);
      if(item.isDirectory()) await walk(file);
      else if(item.name.endsWith('.json') && item.isFile()) {
        const data = JSON.parse(await fs.readFile(file,'utf8')) as Segment[];
        if (!Array.isArray(data) || data.some(s=>!s || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start<0 || s.end<=s.start || typeof s.text!=='string')) throw Error(`Invalid transcript: ${file}`);
        result['sources/'+path.relative(dir,file).replace(/\\/g,'/').slice(0,-5)] = data;
      }
    }
  }
  try { await walk(dir); } catch(e) { if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
  return result;
}
export function edit(t: Timeline, command: string, args: string[]): Timeline {
  const next: Timeline = structuredClone(t);
  const index = next.clips.findIndex(c=>c.id===args[0]);
  if(command==='add') {
    const [id,source,start,end,...reason]=args;
    next.clips.push({id,source,in:Number(start),out:Number(end),...(reason.length?{reason:reason.join(' ')}:{})});
  } else {
    if(index<0) throw Error(`Unknown clip: ${args[0]}`);
    if(command==='remove') next.clips.splice(index,1);
    else if(command==='trim') {next.clips[index].in=Number(args[1]);next.clips[index].out=Number(args[2]);}
    else if(command==='move') {
      const to = Number(args[1]);
      if(!Number.isInteger(to)||to<0||to>=next.clips.length) throw Error('move index must be zero-based and inside the timeline');
      next.clips.splice(to,0,next.clips.splice(index,1)[0]);
    } else throw Error(`Unknown edit: ${command}`);
  }
  return validate(next);
}
