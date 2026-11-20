import {checkProject,hardFailures} from './check';
import * as path from 'node:path';
import {readTimeline,writeTimeline,edit,duration,transcripts} from './core';
import {validateMedia,exportTimeline,ensureProxy} from './media';
import {commit} from './history';
import {computeSignal,sourceList,candidates,candidateTimeline} from './signals';
import {sequenceModel} from './sequence';
export async function main(argv:string[]) {
  const args=[...argv];let root=process.cwd();
  if(args[0]==='--project') {args.shift();root=path.resolve(args.shift()||'.');}
  const command=args.shift();
  if(!command||command==='help') {console.log('vidcli [--project PATH] signals [--source sources/FILE] | candidates --target SEC [--win 10|20|30] [--source sources/FILE] [--apply] | summary | search KEYWORD | add ID sources/FILE IN OUT [REASON] | remove ID | trim ID IN OUT | move ID INDEX | check [--json] | validate | proxies | commit MESSAGE | export');return;}
  if(command==='search') {
    const keyword=args.join(' ').toLocaleLowerCase();if(!keyword) throw Error('Keyword required');
    for(const [source,segments] of Object.entries(await transcripts(root))) for(const s of segments) if(s.text.toLocaleLowerCase().includes(keyword)) console.log(JSON.stringify({source,...s}));return;
  }
  if(command==='signals'||command==='candidates') {
    const options=new Map<string,string>();let apply=false;
    while(args.length){const key=args.shift()!;if(key==='--apply'&&command==='candidates'){apply=true;continue;}if(!['--source',...(command==='candidates'?['--target','--win']:[])].includes(key)||!args.length||args[0].startsWith('--'))throw Error('Invalid option: '+key);options.set(key,args.shift()!);}
    if(command==='signals'){for(const source of await sourceList(root,options.get('--source'))){const s=await computeSignal(root,source);console.log(JSON.stringify({source,hash:s.hash,duration:s.duration,windows:s.windows.length,file:'signals/'+source.slice(8)+'.json'}));}}
    else {const target=Number(options.get('--target')),win=Number(options.get('--win')||20),scenes=await candidates(root,target,win,options.get('--source'));let applied;
      if(apply){const next=candidateTimeline(scenes,target);await validateMedia(root,next);await writeTimeline(root,next);applied={duration:duration(next),clips:next.clips.length};}
      console.log(JSON.stringify({target,win,candidates:scenes,...(applied?{applied}:{})},null,2));}
    return;
  }
  const t=await readTimeline(root);
  if(command==='sequence') {const operation=JSON.parse(args.join(' '));const next=sequenceModel.toTimeline(t,sequenceModel.operate(sequenceModel.fromTimeline(t),operation));await validateMedia(root,next);await writeTimeline(root,next);console.log(`sequence ${operation.action}: ${duration(next).toFixed(3)}s`);return;}
  if(command==='summary') console.log(JSON.stringify({clips:t.clips.length,duration:duration(t),timeline:t},null,2));
  else if(command==='check') {const report=await checkProject(root,t);console.log(args.includes('--json')?JSON.stringify(report,null,2):report.summary+'\n'+report.results.map(r=>`${r.status} [${r.kind}] ${r.id}: ${r.message} | 기대 ${JSON.stringify(r.expected)} | 실제 ${JSON.stringify(r.actual)} | ${JSON.stringify(r.offending)}`).join('\n'));if(hardFailures(report.results))process.exitCode=1;}
  else if(command==='validate') {await validateMedia(root,t);console.log('Timeline valid');}
  else if(['add','remove','trim','move'].includes(command)) {const next=edit(t,command,args);await validateMedia(root,next);await writeTimeline(root,next);console.log(`${command}: ${next.clips.length} clips, ${duration(next).toFixed(2)}s`);}
  else if(command==='commit') {await validateMedia(root,t);console.log(await commit(root,args.join(' ')));}
  else if(command==='proxies') {if(args[0]&&!['webm','mp4'].includes(args[0]))throw Error('Proxy format must be webm or mp4');for(const s of new Set(t.clips.map(c=>c.source))) console.log(await ensureProxy(root,s,args[0] as 'webm'|'mp4'|undefined));}
  else if(command==='export') console.log(await exportTimeline(root,t,async()=>args.includes('--allow-hard-fail')));
  else throw Error(`Unknown command: ${command}`);
}
