import * as path from 'node:path';
import {run} from './media';
import {validate,Timeline,writeTimeline} from './core';
async function location(root:string) {
  const prefix=(await run('git',['rev-parse','--show-prefix'],root)).trim();
  return prefix+'timeline.json';
}
export async function versions(root:string) {
  const text=await run('git',['log','-40','--format=%H%x09%aI%x09%s','--','timeline.json'],root);
  return text.trim().split('\n').filter(Boolean).map(line=>{const [hash,date,...message]=line.split('\t');return {hash,date,message:message.join('\t')};});
}
export async function version(root:string,hash:string):Promise<Timeline> {
  if(!/^[a-f0-9]{40}$/.test(hash)) throw Error('Invalid commit hash');
  return validate(JSON.parse(await run('git',['show',`${hash}:${await location(root)}`],root)));
}
export async function commit(root:string,message:string) {
  if(!message.trim()) throw Error('Commit message required');
  await run('git',['add','--','timeline.json'],root);
  return run('git',['commit','--only','-m',message,'--','timeline.json'],root);
}
