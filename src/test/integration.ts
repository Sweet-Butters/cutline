import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {writeTimeline,readTimeline} from '../core';
async function until<T>(fn:()=>T,description:string,timeout=180000):Promise<NonNullable<T>>{
  const start=Date.now();while(Date.now()-start<timeout){const result=fn();if(result)return result as NonNullable<T>;await new Promise(r=>setTimeout(r,100));}throw Error(`Timed out: ${description}`);
}
export async function run(){
  const root=process.env.CUTLINE_TEST_ROOT!,sample=path.join(root,'sample-project'),file=path.join(sample,'timeline.json');
  const original=await fs.readFile(file,'utf8');
  const logFile=path.join(sample,'.cutline/edit-log.jsonl');const oldLog=await fs.readFile(logFile).catch(()=>undefined);
  const referenceFile=path.join(sample,'reference','integration.timeline.json');await fs.mkdir(path.dirname(referenceFile),{recursive:true});await fs.writeFile(referenceFile,original);
  const extension=vscode.extensions.getExtension('cutline-local.cutline');assert.ok(extension);const api=await extension.activate();
  try{
    assert.equal(await api.startup,true,'Automatically opens a timeline project');
    assert.ok(!vscode.window.terminals.some(t=>t.name==='Ask agent'),'Terminal hidden by default');
    await until(()=>api.events.some((e:any)=>e.type==='chatReady'),'chat initialized');
    assert.equal(vscode.workspace.getConfiguration('files').get<Record<string,boolean>>('exclude')?.['**/.cutline-cache'],true);
    const reference=await until(()=>api.events.find((e:any)=>e.type==='referencesApplied'&&e.items.some((i:any)=>i.name==='integration.timeline.json')),'reference track rendered');
    assert.equal(reference.items.find((i:any)=>i.name==='integration.timeline.json').metrics.f1,1);
    await vscode.commands.executeCommand('cutline.askAgent');
    const first=await until(()=>api.events.find((e:any)=>e.type==='applied'),'webview received first timeline');assert.equal(first.clipCount,4);
    assert.ok(vscode.window.tabGroups.all.some(g=>g.viewColumn===vscode.ViewColumn.One&&g.tabs.some(t=>t.input instanceof vscode.TabInputWebview)),'Chat and video use full editor width');
    const metadata=await until(()=>api.events.find((e:any)=>e.type==='playback'&&e.event==='loadedmetadata'),'proxy loadedmetadata (including automatic fallback)',60000);
    assert.equal(metadata.width,640);
    const canplay=await until(()=>api.events.find((e:any)=>e.type==='playback'&&e.event==='canplay'),'proxy canplay',30000);assert.ok(metadata.duration>119);
    await api.codecProbe('sources/camera-1.mp4');const codec=await until(()=>api.events.find((e:any)=>e.type==='codecResult'),'H264/AAC runtime probe',20000);
    const t=await readTimeline(sample);t.clips.splice(1,1);t.clips[0].out=30;t.clips.push({id:'new-hook',source:'sources/camera-2.mp4',in:90,out:100,reason:'테스트: 핵심만 선택'});
    const changedAt=Date.now();await writeTimeline(sample,t);
    const applied=await until(()=>api.events.find((e:any)=>e.type==='applied'&&e.diff?.added?.some((c:any)=>c.id==='new-hook')),'webview acknowledged live diff');
    const diffLatencyMs=Date.now()-changedAt;
    await until(()=>api.events.some((e:any)=>e.type==='referencesApplied'&&e.items.some((i:any)=>i.name==='integration.timeline.json'&&i.metrics.aiDuration===160&&i.metrics.f1<1)),'reference metrics update live');
    assert.equal(applied.diff.added.length,1);assert.equal(applied.diff.removed.length,1);assert.equal(applied.diff.trimmed.length,1);assert.equal(applied.diff.before,240);assert.equal(applied.diff.after,160);assert.equal(applied.ghosts,1);assert.equal(applied.blocks,4);assert.match(applied.banner,/04:00 → 02:40/);
    const snapshot=async(tag:string)=>{await api.testAction('snapshot',{tag});return until(()=>api.events.find((e:any)=>e.type==='snapshot'&&e.tag===tag),tag,10000);};
    await api.testAction('transcript',{index:1});await new Promise(r=>setTimeout(r,500));const transcript=await snapshot('transcript-seek');assert.ok(transcript.time>=20&&transcript.time<21);assert.match(transcript.transcript,/문제/);
    await api.testAction('select',{index:0,time:29.7});await new Promise(r=>setTimeout(r,300));await api.testAction('play',{muted:true});
    // Wait for decoded frames across the cut, including on a busy build machine.
    let playback:any;const playbackDeadline=Date.now()+30000;let attempt=0;
    do {await new Promise(r=>setTimeout(r,250));playback=await snapshot('cross-source-playback-'+attempt++);}
    while((playback.index!==1||playback.frames===0||playback.paused)&&Date.now()<playbackDeadline);
    assert.equal(playback.index,1);assert.equal(playback.paused,false);assert.ok(playback.frames>0);assert.equal(playback.width,640);
    await api.testAction('play');
    assert.ok(playback.versionCount>0);await api.testAction('version',{index:0});const versionSent=await until(()=>api.events.find((e:any)=>e.type==='sent'&&e.message.version),'version preview');await until(()=>api.events.some((e:any)=>e.type==='applied'&&e.revision===versionSent.message.revision),'version DOM applied');const preview=await snapshot('version-preview');assert.match(preview.version,/Preview:/);
    await api.testAction('click',{id:'compare'});const comparison=await until(()=>api.events.find((e:any)=>e.type==='comparisonApplied'),'version comparison');assert.equal(comparison.diff.after,160);
    await api.testAction('click',{id:'current'});const currentSent=await until(()=>api.events.find((e:any)=>e.type==='sent'&&!e.message.version&&e.message.revision>versionSent.message.revision),'current sent');await until(()=>api.events.some((e:any)=>e.type==='applied'&&e.revision===currentSent.message.revision),'current DOM applied');const working=await snapshot('current');assert.equal(working.version,'Current working file');
    const editStart=api.events.length;
    await api.testAction('select',{index:0,time:10});await new Promise(r=>setTimeout(r,300));
    await api.testAction('click',{id:'split'});
    await until(()=>api.events.slice(editStart).some((e:any)=>e.type==='applied'&&e.clipCount===5),'manual split diff');
    assert.equal((await readTimeline(sample)).clips[0].out,10);
    await api.testAction('click',{id:'undo'});
    await until(()=>api.events.slice(editStart).filter((e:any)=>e.type==='applied').length>=2,'undo diff');
    assert.equal((await readTimeline(sample)).clips.length,4);
    await api.testAction('click',{id:'redo'});
    await until(()=>api.events.slice(editStart).filter((e:any)=>e.type==='applied').length>=3,'redo diff');
    await api.testAction('manual',{edit:'trim',data:{id:'intro',in:1,out:9}});
    await until(()=>api.events.slice(editStart).some((e:any)=>e.type==='applied'&&e.diff?.trimmed?.some((c:any)=>c.in===1&&c.out===9)),'manual trim diff');
    await api.testAction('click',{id:'delete'});
    await until(()=>api.events.slice(editStart).some((e:any)=>e.type==='applied'&&e.diff?.removed?.some((c:any)=>c.id==='intro')),'manual delete diff');
    const editLog=(await fs.readFile(logFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(editLog.slice(-5).map(e=>e.action),['split','undo','redo','trim','delete']);assert.ok(editLog.slice(-5).every(e=>e.who==='human'));
    // Invalid JSON must keep the last valid panel rather than applying an empty state.
    const sentBefore=api.events.filter((e:any)=>e.type==='sent').length;await fs.writeFile(file,'{"version":');await new Promise(r=>setTimeout(r,700));assert.equal(api.events.filter((e:any)=>e.type==='sent').length,sentBefore);
    api.dispose();
    const config=vscode.workspace.getConfiguration('cutline');
    const oldSetting=config.inspect('autoOpenPanel')?.globalValue;
    try {
      await config.update('autoOpenPanel',false,vscode.ConfigurationTarget.Global);
      assert.equal(await api.testAutoOpen(),false,'Opt-out prevents automatic panel');
      await until(()=>!vscode.window.tabGroups.all.some(g=>g.tabs.some(t=>t.input instanceof vscode.TabInputWebview)),'Opt-out leaves no panel',10000);
      await vscode.commands.executeCommand('cutline.open');
      await until(()=>vscode.window.tabGroups.all.some(g=>g.tabs.some(t=>t.input instanceof vscode.TabInputWebview)),'Manual command still works',10000);
      api.dispose();
      await config.update('autoOpenPanel',true,vscode.ConfigurationTarget.Global);
      await fs.rename(file,file+'.test-backup');
      try {assert.equal(await api.testAutoOpen(),false,'No timeline means no automatic panel');}
      finally {await fs.rename(file+'.test-backup',file);}
    } finally {await config.update('autoOpenPanel',oldSetting,vscode.ConfigurationTarget.Global);}
    const report={autoOpen:true,optOut:true,manualOpenWithOptOut:true,noTimeline:true,vscode:vscode.version,extensionPath:extension.extensionPath,diffLatencyMs,proxy:{format:applied.format,metadata,canplay,playback},webmErrors:api.events.filter((e:any)=>e.type==='playback'&&e.event==='error'),h264:codec,diff:applied,transcript,preview,comparison,beside:true,invalidJsonPreservesPanel:true};
    await fs.writeFile(path.join(root,'.test-data','integration-report.json'),JSON.stringify(report,null,2));console.log('CUTLINE INTEGRATION PASSED',JSON.stringify(report));
  }finally{if(oldLog)await fs.writeFile(logFile,oldLog);else await fs.rm(logFile,{force:true});await fs.rm(referenceFile,{force:true});await fs.writeFile(path.join(root,'.test-data','integration-events.json'),JSON.stringify(api.events,null,2));await fs.writeFile(file,original);api.dispose();}
}
