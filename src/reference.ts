import {Timeline,duration,validate} from './core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export function kept(t:Timeline,source:string) {
  const result:{in:number;out:number}[]=[];
  for(const c of t.clips.filter(c=>c.source===source).sort((a,b)=>a.in-b.in)) {
    const last=result.at(-1);
    if(last&&c.in<=last.out)last.out=Math.max(last.out,c.out);
    else result.push({in:c.in,out:c.out});
  }
  return result;
}
export function referenceMetrics(ai:Timeline,human:Timeline) {
  let aiKept=0,humanKept=0,overlap=0;
  for(const source of new Set([...ai.clips,...human.clips].map(c=>c.source))) {
    const a=kept(ai,source),h=kept(human,source);
    aiKept+=a.reduce((n,c)=>n+c.out-c.in,0);humanKept+=h.reduce((n,c)=>n+c.out-c.in,0);
    let i=0,j=0;
    while(i<a.length&&j<h.length){overlap+=Math.max(0,Math.min(a[i].out,h[j].out)-Math.max(a[i].in,h[j].in));if(a[i].out<h[j].out)i++;else j++;}
  }
  return {aiKept,humanKept,overlap,precision:aiKept?overlap/aiKept:humanKept?0:1,recall:humanKept?overlap/humanKept:aiKept?0:1,f1:aiKept+humanKept?2*overlap/(aiKept+humanKept):1,aiDuration:duration(ai),humanDuration:duration(human)};
}
export async function readReferences(root:string) {
  const dir=path.join(root,'reference');
  let names:string[];
  try{names=await fs.readdir(dir);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  return Promise.all(names.filter(n=>n.endsWith('.timeline.json')).sort().map(async name=>({name,timeline:validate(JSON.parse(await fs.readFile(path.join(dir,name),'utf8')))})));
}
