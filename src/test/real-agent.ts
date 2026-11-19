import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {readTimeline} from '../core';
import {versions} from '../history';
const wait=async(fn:()=>any,label:string,timeout=300000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,200));}throw Error('Timeout: '+label);};
export async function run(){
  const root=process.env.CUTLINE_TEST_ROOT!,project=vscode.workspace.workspaceFolders![0].uri.fsPath;
  const extension=vscode.extensions.getExtension('cutline-local.cutline')!,api=await extension.activate();
  await api.startup;await wait(()=>api.events.some((e:any)=>e.type==='chatReady'),'chat ready');await wait(()=>api.events.some((e:any)=>e.type==='applied'),'timeline');
  const results=[];
  try{for(const backend of ['claude','codex']){
    await api.testAction('resetChat',{backend});await new Promise(r=>setTimeout(r,200));
    const before=await readTimeline(project),end=before.clips[0].out-1;
    const prompt=`timeline.json 첫 클립의 out을 ${end}로 바꾸고 reason을 "${backend} 채팅 검증"으로 저장해 줘. 다른 값은 유지해. 실제 파일을 수정하고 한 문장으로 답해. git 커밋은 앱이 수행하므로 하지 마.`;
    const startIndex=api.events.length,started=Date.now();
    await api.testAction('chat',{backend,prompt});
    await wait(()=>api.events.slice(startIndex).some((e:any)=>e.type==='chatEvent'&&e.kind==='done'),backend+' complete');
    await new Promise(r=>setTimeout(r,1500));
    const events=api.events.slice(startIndex),after=await readTimeline(project),history=await versions(project);
    const errors=events.filter((e:any)=>e.type==='chatEvent'&&e.kind==='error');
    const diff=events.find((e:any)=>e.type==='applied'&&e.diff?.trimmed?.some((c:any)=>c.id===before.clips[0].id&&c.out===end));
    const committed=history.some(v=>v.message==='agent: '+prompt);
    const durationMs=Date.now()-started;
    const followStart=api.events.length;
    await api.testAction('chat',{backend,prompt:'방금 편집한 파일은 변경하지 말고 node tools/vidcli.js validate 와 node tools/compare.js 를 실제로 실행해서 검증 결과와 F1을 알려 줘. 다른 도구는 필요 없어.'});
    await wait(()=>api.events.slice(followStart).some((e:any)=>e.type==='chatEvent'&&e.kind==='done'),backend+' resume validation');
    const followEvents=api.events.slice(followStart);
    const followVerified=followEvents.some((e:any)=>e.kind==='step'&&e.text==='타임라인 검증')&&followEvents.some((e:any)=>e.kind==='step'&&e.text.startsWith('compare 실행: F1'));
    results.push({backend,durationMs,changed:after.clips[0].out===end,diff:!!diff,committed,errors,events,followEvents,followVerified});
  }}finally{
    await fs.writeFile(path.join(root,'.test-data/real-agent-report.json'),JSON.stringify(results,null,2));api.dispose();
  }
  console.log('REAL AGENT REPORT',JSON.stringify(results.map(({events,...r})=>r)));
  if(results.some(r=>!r.changed||!r.diff||!r.committed||r.errors.length||!r.followVerified))throw Error('Real agent validation failed; see .test-data/real-agent-report.json for exact output');
}
