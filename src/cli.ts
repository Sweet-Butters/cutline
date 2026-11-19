import * as path from 'node:path';
import {readTimeline,writeTimeline,edit,duration,transcripts} from './core';
import {validateMedia,exportTimeline,ensureProxy} from './media';
import {commit} from './history';
export async function main(argv:string[]) {
  const args=[...argv];let root=process.cwd();
  if(args[0]==='--project') {args.shift();root=path.resolve(args.shift()||'.');}
  const command=args.shift();
  if(!command||command==='help') {console.log('vidcli [--project PATH] summary | search KEYWORD | add ID sources/FILE IN OUT [REASON] | remove ID | trim ID IN OUT | move ID INDEX | validate | proxies | commit MESSAGE | export');return;}
  if(command==='search') {
    const keyword=args.join(' ').toLocaleLowerCase();if(!keyword) throw Error('Keyword required');
    for(const [source,segments] of Object.entries(await transcripts(root))) for(const s of segments) if(s.text.toLocaleLowerCase().includes(keyword)) console.log(JSON.stringify({source,...s}));return;
  }
  const t=await readTimeline(root);
  if(command==='summary') console.log(JSON.stringify({clips:t.clips.length,duration:duration(t),timeline:t},null,2));
  else if(command==='validate') {await validateMedia(root,t);console.log('Timeline valid');}
  else if(['add','remove','trim','move'].includes(command)) {const next=edit(t,command,args);await validateMedia(root,next);await writeTimeline(root,next);console.log(`${command}: ${next.clips.length} clips, ${duration(next).toFixed(2)}s`);}
  else if(command==='commit') {await validateMedia(root,t);console.log(await commit(root,args.join(' ')));}
  else if(command==='proxies') {for(const s of new Set(t.clips.map(c=>c.source))) console.log(await ensureProxy(root,s));}
  else if(command==='export') console.log(await exportTimeline(root,t));
  else throw Error(`Unknown command: ${command}`);
}
