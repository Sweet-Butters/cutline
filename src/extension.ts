import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {randomBytes} from 'node:crypto';
import {BRAND} from './brand';
import {Timeline,readTimeline,writeTimeline,diffTimeline,transcripts,sourcePath} from './core';
import {ensureProxy,validateMedia,exportTimeline,ProxyFormat,cacheDirectory,stopMediaWorkers} from './media';
import {readReferences,referenceMetrics,kept} from './reference';
import * as history from './history';
import {AgentRun,Backend,prompts} from './agent';
import {EditSession,recordAgentEdit,same} from './editing';

export function activate(context:vscode.ExtensionContext) {
  context.subscriptions.push({dispose:stopMediaWorkers});
  const output=vscode.window.createOutputChannel('Cutline',{log:true});context.subscriptions.push(output);
  let panel:vscode.WebviewPanel|undefined, root='', current:Timeline|undefined, shown:Timeline|undefined, selected:string|undefined;
  let revision=0, loadRequest=0, ready=false, timer:NodeJS.Timeout|undefined;
  let proxyFormat:ProxyFormat=context.extensionMode===vscode.ExtensionMode.Test?'webm':context.workspaceState.get<ProxyFormat>('proxyFormat','webm');
  let lastDiff:ReturnType<typeof diffTimeline>|undefined;let shownVersion:string|undefined;
  let watchers:vscode.Disposable[]=[];
  let terminal:vscode.Terminal|undefined;
  let agent:AgentRun|undefined, agentBefore:Timeline|undefined, agentPrompt='', finishing=false;
  let backend:Backend=context.globalState.get<Backend>('agentBackend','claude');
  const sessions:Partial<Record<Backend,string>>=context.workspaceState.get('agentSessions',{});
  const edits=new EditSession();let editQueue=Promise.resolve();
  const chat=(event:any)=>{record({type:'chatEvent',...event});return send({type:'chatEvent',...event});};
  context.subscriptions.push({dispose:()=>{void agent?.stop();}});
  async function captureAgent(next:Timeline){
    if(!agentBefore||same(agentBefore,next))return;
    const before=agentBefore;agentBefore=structuredClone(next);edits.clear();
    try{const autoCommit=vscode.workspace.getConfiguration('cutline').get('autoCommitAgentEdits',true);await recordAgentEdit(root,agentPrompt,before,next,autoCommit);await chat({kind:'step',text:autoCommit?'timeline.json 저장 · 버전 반영':'timeline.json 저장 · 자동 커밋 꺼짐'});}
    catch(e){await chat({kind:'error',text:'편집은 저장됐지만 로그/버전 저장 실패: '+String(e)});}
    await listVersions();
  }
  async function startAgent(prompt:string,choice:Backend){
    if(agent||finishing)throw Error('에이전트가 실행 중입니다');
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw Error('프롬프트를 입력하세요 (최대 20,000자)');
    if(choice!=='claude'&&choice!=='codex')throw Error('Unknown backend');
    if(selected)throw Error('Current로 돌아온 후 편집하세요');
    finishing=true;
    try{await editQueue.catch(()=>{});agentBefore=await readTimeline(root);}catch(e){finishing=false;throw e;}
    agentPrompt=prompt;backend=choice;
    await context.globalState.update('agentBackend',backend);
    const run=agent=new AgentRun(),started=Date.now();finishing=false;await chat({kind:'start',text:prompt,backend,started});
    try{
      const result=await run.run(root,backend,prompt,e=>{
        if(e.kind==='session'){sessions[backend]=e.text;void context.workspaceState.update('agentSessions',sessions);}
        else void chat(e);
      },sessions[backend],vscode.workspace.getConfiguration('cutline').get('codexSandbox','danger-full-access'),context.extensionMode===vscode.ExtensionMode.Test&&process.env.CUTLINE_AGENT_TRACE?line=>{void fs.appendFile(path.join(process.env.CUTLINE_AGENT_TRACE!,backend+'.jsonl'),line+'\n');}:undefined);
      await chat({kind:'step',text:result.stopped?'중단됨 · 저장된 편집은 유지됩니다':'실행 완료'});
    }catch(e){await chat({kind:'error',text:String(e)});}
    finally{
      finishing=true;
      try{await editQueue.catch(()=>{});const final=await readTimeline(root);await validateMedia(root,final);await captureAgent(final);}catch(e){await chat({kind:'error',text:String(e)});}
      agent=undefined;agentBefore=undefined;finishing=false;
      await chat({kind:'done',elapsedMs:Date.now()-started});await send({type:'editState',...edits.state});
      void reload();
    }
  }
  async function openTerminal(){
    if(!terminal||terminal.exitStatus)terminal=vscode.window.createTerminal({name:'Ask agent',cwd:root||await getRoot()});
    await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
    await vscode.commands.executeCommand('workbench.action.alignPanelCenter');
    terminal.show(true);
  }
  const ask=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,100);ask.text='$(comment-discussion) Ask agent';ask.command='cutline.askAgent';ask.show();context.subscriptions.push(ask,vscode.commands.registerCommand('cutline.askAgent',async()=>{await open();await send({type:'focusChat'});}));
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
    shown=t;shownVersion=version;lastDiff=diff;
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
      await send({type:'clearError'});
      if(agentBefore){editQueue=editQueue.catch(()=>{}).then(()=>captureAgent(next));await editQueue;}
      const references=await readReferences(root);
      const metadata=await validateMedia(root,next);
      for(const reference of references)for(const [source,meta] of await validateMedia(root,reference.timeline))metadata.set(source,meta);
      if(request!==loadRequest)return;
      await send({type:'references',items:references.map(r=>({name:r.name,metrics:referenceMetrics(next,r.timeline),sources:[...metadata].map(([source,meta])=>({source,duration:meta.duration,ai:kept(next,source),human:kept(r.timeline,source)}))}))});
      if(selected) {await send({type:'status',message:'Current file changed. Viewing history; choose Current to return.'});await listVersions();return;}
      if(!old||shownVersion||!same(old,next))await display(next,old?diffTimeline(old,next):undefined);
      else await listVersions();
    } catch(e) {if(request===loadRequest)await fail(e);}
  }
  async function open(folder?:string) {
    if(panel){panel.reveal(vscode.ViewColumn.One);return;}
    if(agent||finishing)throw Error('에이전트 종료를 기다린 후 패널을 다시 여세요');
    edits.clear();
    root=folder??await getRoot();current=undefined;shown=undefined;selected=undefined;ready=false;
    panel=vscode.window.createWebviewPanel('cutline.video',BRAND,vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.file(cacheDirectory(root)),vscode.Uri.file(path.join(root,'sources')),vscode.Uri.joinPath(context.extensionUri,'media')]});
    panel.webview.html=html(panel.webview,context.extensionUri);
    panel.onDidDispose(()=>{void agent?.stop();panel=undefined;ready=false;++revision;if(timer)clearTimeout(timer);watchers.forEach(w=>w.dispose());watchers=[];});
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
      if(m.type==='layout')output.info(JSON.stringify({root,...m}));
      try {
        if(m.type==='ready'){ready=true;let chips;try{chips=await prompts(root);}catch(e){await chat({kind:'error',text:String(e)});}await send({type:'chatInit',backend,prompts:chips});await reload();}
        if(m.type==='agentSend')void startAgent(m.prompt,m.backend).catch(e=>chat({kind:'error',text:String(e)}));
        if(m.type==='agentStop')await agent?.stop();
        if(m.type==='agentBackend'&&(m.backend==='claude'||m.backend==='codex')){backend=m.backend;await context.globalState.update('agentBackend',backend);}
        if(m.type==='agentNew'&&!agent){delete sessions[backend];await context.workspaceState.update('agentSessions',sessions);await chat({kind:'step',text:'새 대화를 시작합니다'});}
        if(m.type==='manual'){
          if(agent||selected)throw Error('에이전트 완료 후 Current에서 편집하세요');
          if(m.revision!==revision)throw Error('타임라인이 변경되었습니다. 최신 화면에서 다시 편집하세요');
          editQueue=editQueue.catch(()=>{}).then(()=>edits.apply(root,m,t=>validateMedia(root,t)));
          await editQueue;await send({type:'editState',...edits.state});
        }
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
    if(vscode.workspace.getConfiguration('cutline',vscode.Uri.file(root)).get('openTerminal',false))await openTerminal();
    else await vscode.commands.executeCommand('workbench.action.closePanel');
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
      await vscode.commands.executeCommand('vscode.setEditorLayout',{orientation:0,groups:[{size:1}]});
      await open(folder.uri.fsPath);
      if(!context.workspaceState.get('layoutInitialized')){
        await vscode.commands.executeCommand('workbench.action.focusSideBar');
        for(let i=0;i<2;i++)await vscode.commands.executeCommand('workbench.action.decreaseViewSize');
        if(!vscode.workspace.getConfiguration('cutline',folder.uri).get('openTerminal',false))await vscode.commands.executeCommand('workbench.action.closePanel');
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
  <div class="workspace"><aside id="chat" aria-label="Agent chat"><div class="chat-heading"><b>편집 에이전트</b><select id="backend" aria-label="Agent backend"><option value="claude">Claude</option><option value="codex">Codex</option></select><button id="new-chat" title="새 대화">＋</button></div><p class="chat-hint">원하는 편집을 말해 주세요.<br>내 구독으로 편집하고, 변경은 영상에 바로 반영됩니다.</p><div id="messages" role="log" aria-live="polite"></div><div id="chips"></div><form id="chat-form"><textarea id="prompt" aria-label="편집 요청" placeholder="어떤 영상을 만들까요?" rows="3" maxlength="20000"></textarea><div class="chat-actions"><span id="elapsed">준비됨</span><button id="stop" type="button" disabled>중단</button><button id="send" type="submit">보내기 ↑</button></div></form></aside><div class="video-workspace"><div id="banner" role="status">Waiting for timeline.json</div><div id="error" role="alert" hidden></div>
  <main><section class="preview"><video id="video" preload="auto" playsinline></video><div id="empty" hidden>No clips. Ask your agent to build a timeline.</div></section>
  <div class="transport"><button id="play">▶ Play</button><button id="previous">⏮</button><button id="next">⏭</button><span id="time">00:00 / 00:00</span><span id="clip"></span></div>
  <input id="scrub" type="range" min="0" max="1" step="0.01" value="0" aria-label="Timeline position">
  <div class="section-title">EDIT ORDER <span>green added · red removed · amber trimmed · blue moved</span></div><div id="timeline" tabindex="0" aria-label="편집 순서 타임라인"></div><div class="edit-tools"><button id="split">분할 S</button><button id="delete">삭제 Del</button><button id="undo" disabled>↶ 되돌리기</button><button id="redo" disabled>↷ 다시 실행</button><span>클립 양 끝을 드래그하여 트림</span></div><div id="ghosts"></div><p id="reason"></p>
  <section id="references" hidden aria-label="Human versus AI original time comparison"></section><details><summary>대본 · 버전 기록</summary><div class="columns"><section><div class="section-title">TRANSCRIPT · click to seek</div><div id="transcript"></div></section><section><div class="section-title">VERSIONS <button id="refresh">↻</button></div><button id="current">Current</button><button id="compare">Diff vs current</button><button id="restore" disabled>Restore</button><div id="version-label"></div><div id="versions"></div></section></div></details></main></div></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
