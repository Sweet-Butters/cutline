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
  const extension=vscode.extensions.getExtension('cutline-local.cutline');assert.ok(extension);const api=await extension.activate();
  try{
    await vscode.window.showTextDocument(vscode.Uri.file(file),{viewColumn:vscode.ViewColumn.One});
    await vscode.commands.executeCommand('cutline.open');
    const first=await until(()=>api.events.find((e:any)=>e.type==='applied'),'webview received first timeline');assert.equal(first.clipCount,4);
    assert.ok(vscode.window.tabGroups.all.some(g=>g.viewColumn!==vscode.ViewColumn.One&&g.tabs.some(t=>t.input instanceof vscode.TabInputWebview)),'Panel opened beside editor');
    const metadata=await until(()=>api.events.find((e:any)=>e.type==='playback'&&e.event==='loadedmetadata'),'WebM loadedmetadata');
    const canplay=await until(()=>api.events.find((e:any)=>e.type==='playback'&&e.event==='canplay'),'WebM canplay');assert.ok(metadata.duration>119);
    await api.codecProbe('sources/camera-1.mp4');const codec=await until(()=>api.events.find((e:any)=>e.type==='codecResult'),'H264/AAC runtime probe',20000);
    const t=await readTimeline(sample);t.clips.splice(1,1);t.clips[0].out=30;t.clips.push({id:'new-hook',source:'sources/camera-2.mp4',in:90,out:100,reason:'테스트: 핵심만 선택'});
    await writeTimeline(sample,t);
    const applied=await until(()=>api.events.find((e:any)=>e.type==='applied'&&e.diff?.added?.some((c:any)=>c.id==='new-hook')),'webview acknowledged live diff');
    assert.equal(applied.diff.added.length,1);assert.equal(applied.diff.removed.length,1);assert.equal(applied.diff.trimmed.length,1);assert.equal(applied.diff.before,240);assert.equal(applied.diff.after,160);assert.equal(applied.ghosts,1);assert.equal(applied.blocks,4);assert.match(applied.banner,/04:00 → 02:40/);
    // Invalid JSON must keep the last valid panel rather than applying an empty state.
    const sentBefore=api.events.filter((e:any)=>e.type==='sent').length;await fs.writeFile(file,'{"version":');await new Promise(r=>setTimeout(r,700));assert.equal(api.events.filter((e:any)=>e.type==='sent').length,sentBefore);
    const report={vscode:vscode.version,webm:{metadata,canplay},h264:codec,diff:applied,beside:true,invalidJsonPreservesPanel:true};
    await fs.writeFile(path.join(root,'.test-data','integration-report.json'),JSON.stringify(report,null,2));console.log('CUTLINE INTEGRATION PASSED',JSON.stringify(report));
  }finally{await fs.writeFile(file,original);api.dispose();}
}
