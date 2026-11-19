import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {randomBytes} from 'node:crypto';
import {BRAND} from './brand';
import {Timeline,readTimeline,writeTimeline,diffTimeline,transcripts,sourcePath} from './core';
import {ensureProxy,validateMedia,exportTimeline,ProxyFormat,cacheDirectory,stopMediaWorkers} from './media';
import {readReferences,referenceMetrics,kept} from './reference';
import * as history from './history';

export function activate(context:vscode.ExtensionContext) {
  context.subscriptions.push({dispose:stopMediaWorkers});
  const output=vscode.window.createOutputChannel('Cutline',{log:true});context.subscriptions.push(output);
  let panel:vscode.WebviewPanel|undefined, root='', current:Timeline|undefined, shown:Timeline|undefined, selected:string|undefined;
  let revision=0, loadRequest=0, ready=false, timer:NodeJS.Timeout|undefined;
  let proxyFormat:ProxyFormat=context.extensionMode===vscode.ExtensionMode.Test?'webm':context.workspaceState.get<ProxyFormat>('proxyFormat','webm');
  let lastDiff:ReturnType<typeof diffTimeline>|undefined;
  let watchers:vscode.Disposable[]=[];
  let terminal:vscode.Terminal|undefined;
  async function openTerminal(){
    if(!terminal||terminal.exitStatus)terminal=vscode.window.createTerminal({name:'Ask agent',cwd:root||await getRoot()});
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    await vscode.commands.executeCommand('workbench.action.alignPanelCenter');
    terminal.show(true);
  }
  const ask=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,100);ask.text='$(terminal) Ask agent';ask.command='cutline.askAgent';ask.show();context.subscriptions.push(ask,vscode.commands.registerCommand('cutline.askAgent',openTerminal));
  const events: any[]=[];
  const record=(event:any)=>{events.push(event);if(events.length>200)events.shift();if(context.extensionMode===vscode.ExtensionMode.Test)console.log('CUTLINE EVENT',JSON.stringify(event));};
  const send=async(message:any)=>{if(panel&&!panel.webview.options.enableScripts)return;await panel?.webview.postMessage(message);};
  const fail=(e:unknown)=>{const message=e instanceof Error?e.message:String(e);output.error(message);record({type:'error',message});return send({type:'error',message});};
  async function getRoot() {
    const folders=vscode.workspace.workspaceFolders;
    if(!folders?.length) throw Error('Open a video project folder first');
    if(folders.length===1)return folders[0].uri.fsPath;
    const chosen=await vscode.window.showWorkspaceFolderPick();if(!chosen)throw Error('No project selected');return chosen.uri.fsPath;
  }
  async function listVersions() {
    try {await send({type:'versions',items:await history.versions(root)});} catch {await send({type:'versions',items:[],warning:'No timeline commits yet. Use vidcli commit after git init.'});}
  }
  async function display(t:Timeline,diff?:ReturnType<typeof diffTimeline>,version?:string) {
    const token=++revision;
    await send({type:'status',message:'Checking sources and preparing playback proxies…'});
    await validateMedia(root,t);
    const proxies:Record<string,string>={};
    for(const source of new Set(t.clips.map(c=>c.source))) {
      if(token!==revision)return;
      const file=await ensureProxy(root,source,proxyFormat,message=>{if(token===revision)void send({type:'status',message:`${source} · ${message}`});});
      if(!panel)return;
      proxies[source]=panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
    }
    const text=await transcripts(root);
    if(token!==revision||!panel)return;
    shown=t;lastDiff=diff;
    const message={type:'timeline',revision:token,timeline:t,diff,proxies,transcripts:text,version,format:proxyFormat};
    record({type:'sent',message});await send(message);await listVersions();
  }
  async function reload() {
    if(!ready)return;
    const request=++loadRequest;
    try {
      const next=await readTimeline(root);
      await validateMedia(root,next);
      if(request!==loadRequest)return;
      const old=shown;current=next;
      const references=await readReferences(root);
      const metadata=await validateMedia(root,next);
      for(const reference of references)for(const [source,meta] of await validateMedia(root,reference.timeline))metadata.set(source,meta);
      if(request!==loadRequest)return;
      await send({type:'references',items:references.map(r=>({name:r.name,metrics:referenceMetrics(next,r.timeline),sources:[...metadata].map(([source,meta])=>({source,duration:meta.duration,ai:kept(next,source),human:kept(r.timeline,source)}))}))});
      if(selected) {await send({type:'status',message:'Current file changed. Viewing history; choose Current to return.'});await listVersions();return;}
      await display(next,old?diffTimeline(old,next):undefined);
    } catch(e) {if(request===loadRequest)await fail(e);}
  }
  async function open(folder?:string) {
    if(panel){panel.reveal(vscode.ViewColumn.Beside);return;}
    root=folder??await getRoot();current=undefined;shown=undefined;selected=undefined;ready=false;
    panel=vscode.window.createWebviewPanel('cutline.video',BRAND,vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.file(cacheDirectory(root)),vscode.Uri.file(path.join(root,'sources')),vscode.Uri.joinPath(context.extensionUri,'media')]});
    panel.webview.html=html(panel.webview,context.extensionUri);
    panel.onDidDispose(()=>{panel=undefined;ready=false;++revision;if(timer)clearTimeout(timer);watchers.forEach(w=>w.dispose());watchers=[];});
    const watch=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'timeline.json'));
    const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void reload(),180);};
    watchers.push(watch,watch.onDidChange(schedule),watch.onDidCreate(schedule),watch.onDidDelete(schedule));
    const tw=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'transcripts/**/*.json'));
    watchers.push(tw,tw.onDidChange(schedule),tw.onDidCreate(schedule),tw.onDidDelete(schedule));
    const rw=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'reference/*.timeline.json'));
    watchers.push(rw,rw.onDidChange(schedule),rw.onDidCreate(schedule),rw.onDidDelete(schedule));
    panel.webview.onDidReceiveMessage(async m=>{
      record(m);
      if(m.type==='playback')output.info(JSON.stringify({root,...m}));
      if(m.type==='referencesApplied')output.info(JSON.stringify({root,...m}));
      try {
        if(m.type==='ready'){ready=true;await reload();}
        if(m.type==='playback'&&m.event==='error'&&m.revision===revision&&proxyFormat==='webm'&&shown) {
          proxyFormat='mp4';await send({type:'status',message:'This VS Code cannot decode WebM. Preparing H.264/MP3 compatibility proxies…'});
          await display(shown,lastDiff,selected);
        }
        if(m.type==='playback'&&m.event==='canplay'&&m.revision===revision)await context.workspaceState.update('proxyFormat',proxyFormat);
        if(m.type==='current'){selected=undefined;await reload();}
        if(m.type==='versions')await listVersions();
        if(m.type==='preview') {const t=await history.version(root,m.hash);await display(t,undefined,m.hash);selected=m.hash;}
        if(m.type==='compare') {if(shown)await send({type:'comparison',diff:diffTimeline(shown,await readTimeline(root))});}
        if(m.type==='restore') {
          if(!selected)throw Error('Select a version first');
          const restoreHash=selected;const t=await history.version(root,restoreHash);await validateMedia(root,t);
          const answer=await vscode.window.showWarningMessage('Replace timeline.json with this version? Commit current edits first if you want to keep them.',{modal:true},'Restore');
          if(answer==='Restore'){await history.restore(root,restoreHash);selected=undefined;await reload();}
        }
        if(m.type==='export')await doExport();
      } catch(e){await fail(e);}
    },undefined,context.subscriptions);
    if(vscode.workspace.getConfiguration('cutline',vscode.Uri.file(root)).get('openTerminal',true))await openTerminal();
  }
  async function doExport() {
    const folder=root||await getRoot();
    const file=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`${BRAND}: Exporting originals`},()=>readTimeline(folder).then(t=>exportTimeline(folder,t)));
    void vscode.window.showInformationMessage(`Exported: ${file}`);await send({type:'status',message:`Exported: ${file}`});
  }
  context.subscriptions.push(vscode.commands.registerCommand('cutline.open',()=>open().catch(e=>vscode.window.showErrorMessage(String(e)))),
    vscode.commands.registerCommand('cutline.export',()=>doExport().catch(e=>vscode.window.showErrorMessage(String(e)))),
    vscode.commands.registerCommand('cutline.import',async()=>{
      try {
        const folder=await getRoot();const files=await vscode.window.showOpenDialog({canSelectMany:true,filters:{Video:['mp4','mov','mkv','webm','avi']}});if(!files)return;
        await fs.mkdir(path.join(folder,'sources'),{recursive:true});
        await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`${BRAND}: Importing and generating proxies`},async()=>{
          for(const f of files){const name=path.basename(f.fsPath),dest=path.join(folder,'sources',name);if(path.resolve(f.fsPath)!==path.resolve(dest))await fs.copyFile(f.fsPath,dest,1);await ensureProxy(folder,'sources/'+name,proxyFormat);}
        });
        void vscode.window.showInformationMessage('Imported. Add clips with vidcli or edit timeline.json.');
      }catch(e){void vscode.window.showErrorMessage(String(e));}
    }));
  async function autoOpen() {
    if(panel)return false;
    for(const folder of vscode.workspace.workspaceFolders??[]) {
      if(!vscode.workspace.getConfiguration('cutline',folder.uri).get('autoOpenPanel',true))continue;
      const timeline=vscode.Uri.joinPath(folder.uri,'timeline.json');
      try {await vscode.workspace.fs.stat(timeline);}catch{continue;}
      await vscode.window.showTextDocument(timeline,{viewColumn:vscode.ViewColumn.One,preview:false});
      await open(folder.uri.fsPath);
      if(!context.workspaceState.get('layoutInitialized')){
        await vscode.commands.executeCommand('workbench.action.focusSideBar');
        for(let i=0;i<2;i++)await vscode.commands.executeCommand('workbench.action.decreaseViewSize');
        await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:0.46},{size:0.54}]});
        await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
        await context.workspaceState.update('layoutInitialized',true);
      }
      return true;
    }
    return false;
  }
  const startup=autoOpen().catch(e=>{output.error(String(e));return false;});
  // Exported diagnostics are local extension API only; codec probe is enabled solely by test mode.
  return {events,startup,async testAutoOpen(){if(context.extensionMode!==vscode.ExtensionMode.Test)throw Error('Test mode only');return autoOpen();},async codecProbe(source:string) {
    if(context.extensionMode!==vscode.ExtensionMode.Test)throw Error('Test mode only');
    const file=await sourcePath(root,source);
    await send({type:'codecProbe',url:panel!.webview.asWebviewUri(vscode.Uri.file(file)).toString()});
  },async testAction(action:string,data:object={}){if(context.extensionMode!==vscode.ExtensionMode.Test)throw Error('Test mode only');await send({type:'testAction',action,...data});},dispose(){panel?.dispose();}};
}
export function deactivate(){stopMediaWorkers();}
function html(webview:vscode.Webview,uri:vscode.Uri) {
  const nonce=randomBytes(16).toString('hex');
  const script=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','panel.js'));
  const style=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','panel.css'));
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src ${webview.cspSource};"><link rel="stylesheet" href="${style}"></head><body>
  <header><b>${BRAND}</b><span class="badge">AGENT VIDEO WORKSPACE</span><button id="export">Export MP4</button></header>
  <div id="banner" role="status">Waiting for timeline.json</div><div id="error" role="alert" hidden></div>
  <main><section id="references" hidden aria-label="Human versus AI original time comparison"></section><section class="preview"><video id="video" preload="auto" playsinline></video><div id="empty" hidden>No clips. Ask your agent to build a timeline.</div></section>
  <div class="transport"><button id="play">▶ Play</button><button id="previous">⏮</button><button id="next">⏭</button><span id="time">00:00 / 00:00</span><span id="clip"></span></div>
  <input id="scrub" type="range" min="0" max="1" step="0.01" value="0" aria-label="Timeline position">
  <div class="section-title">TIMELINE <span>green added · red removed · amber trimmed · blue moved</span></div><div id="timeline"></div><div id="ghosts"></div><p id="reason"></p>
  <div class="columns"><section><div class="section-title">TRANSCRIPT · click to seek</div><div id="transcript"></div></section><section><div class="section-title">VERSIONS <button id="refresh">↻</button></div><button id="current">Current</button><button id="compare">Diff vs current</button><button id="restore" disabled>Restore</button><div id="version-label"></div><div id="versions"></div></section></div></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
