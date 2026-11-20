import {playbackServer} from './playback';
import {checkProject} from './check';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {randomBytes} from 'node:crypto';
import {BRAND} from './brand';
import {Timeline,readTimeline,writeTimeline,diffTimeline,transcripts,sourcePath} from './core';
import {readSignalWindows} from './signals';
import {ensureProxy,validateMedia,exportTimeline,ProxyFormat,cacheDirectory,stopMediaWorkers} from './media';
import {readReferences,referenceMetrics,kept} from './reference';
import * as history from './history';
import {AgentRun,Backend,prompts} from './agent';
import {EditSession,recordAgentEdit,same} from './editing';
import {sequenceModel} from './sequence';
import {prepareSequenceAssets} from './sequence-media';
import {probe} from './media';
import {FeedbackStore,FeedbackConflict} from './feedback';
import {timelineId} from './feedback-anchor';
import {HelperChat} from './helper';

export function activate(context:vscode.ExtensionContext) {
  context.subscriptions.push({dispose:stopMediaWorkers});
  const output=vscode.window.createOutputChannel('Cutline',{log:true});context.subscriptions.push(output);
  let playback:Awaited<ReturnType<typeof playbackServer>>|undefined;
  context.subscriptions.push({dispose:()=>playback?.dispose()});
  let panel:vscode.WebviewPanel|undefined, root='', current:Timeline|undefined, shown:Timeline|undefined, selected:string|undefined;
  let revision=0, loadRequest=0, ready=false, timer:NodeJS.Timeout|undefined;
  let proxyFormat:ProxyFormat=context.extensionMode===vscode.ExtensionMode.Test?'webm':context.workspaceState.get<ProxyFormat>('proxyFormat','webm');
  let lastDiff:ReturnType<typeof diffTimeline>|undefined;let shownVersion:string|undefined;
  let feedback:FeedbackStore|undefined,feedbackPreview:string|undefined,feedbackLoad=0,feedbackNavigation=0,feedbackTimer:NodeJS.Timeout|undefined;
  let watchers:vscode.Disposable[]=[];
  let terminal:vscode.Terminal|undefined;
  let agent:AgentRun|undefined, agentBefore:Timeline|undefined, agentPrompt='', finishing=false;
  let backend:Backend=context.globalState.get<Backend>('agentBackend','claude');
  const sessions:Partial<Record<Backend,string>>=context.workspaceState.get('agentSessions',{});
  let helper:HelperChat|undefined;
  const helperDirectory=path.join((context.storageUri??context.globalStorageUri).fsPath,'helper-workspace');
  const edits=new EditSession();let editQueue=Promise.resolve();
  const chat=(event:any)=>{record({type:'chatEvent',...event});return send({type:'chatEvent',...event});};
  context.subscriptions.push({dispose:()=>{void agent?.stop();void helper?.stop();}});
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
    if(selected||feedbackPreview)throw Error('Current로 돌아온 후 편집하세요');
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
      try{await chat({kind:'step',text:(await checkProject(root,await readTimeline(root))).summary});}catch(e){await chat({kind:'error',text:'검증 미완료: '+String(e)});}
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
  async function publishFeedback(t=shown,gitHint=selected){
    if(!feedback||!t||!panel||!ready)return;const store=feedback,ticket=++feedbackLoad,docId=timelineId(t);
    try{const state=await store.view(t,gitHint);if(store===feedback&&ticket===feedbackLoad&&shown&&timelineId(shown)===docId)await send({type:'feedbackState',state,viewVersionId:docId,renderRevision:revision,preview:!!(selected||feedbackPreview)});}
    catch(error){if(store===feedback&&ticket===feedbackLoad)await send({type:'feedbackError',message:error instanceof Error?error.message:String(error)});}
  }
  async function handleFeedback(m:any){
    const store=feedback,t=shown?structuredClone(shown):undefined;if(!store||!t)return;
    const docId=timelineId(t),hint=selected,requestId=m.requestId;
    try{
      if(m.action==='load'){await publishFeedback();return;}
      if(m.action==='navigate'){
        if(!['view','current','original'].includes(m.mode))throw Error('잘못된 버전 이동입니다.');
        const ticket=++feedbackNavigation;
        if(m.mode==='view'&&(m.viewVersionId!==docId||m.viewRevision!==revision))throw Error('보는 버전이 변경되어 이동을 취소했습니다.');
        let target=t,targetId=docId;
        if(m.mode==='current'){target=await readTimeline(root);targetId=timelineId(target);}
        if(m.mode==='original'){targetId=await store.originalVersion(m.threadId);target=await store.snapshot(targetId);}
        const navigation=await store.navigation(m.threadId,target,m.mode==='original');
        if(store!==feedback)return;
        if(ticket!==feedbackNavigation)throw Error('다른 버전 이동 요청으로 취소되었습니다. 현재 화면에서 다시 시도하세요.');
        if((m.mode==='current'||m.mode==='view'&&!selected&&!feedbackPreview)&&timelineId(await readTimeline(root))!==targetId)throw Error('편집 내용이 변경되어 이동을 취소했습니다. 다시 시도하세요.');
        const switchView=targetId!==docId||m.mode==='current'&&!!(selected||feedbackPreview);
        if(switchView){
          if(agent||finishing)throw Error('에이전트 편집이 끝난 뒤 다른 버전으로 이동하세요.');
          const previous={selected,feedbackPreview};
          try{
            if(m.mode==='current'){selected=undefined;feedbackPreview=undefined;}
            else{const info=await store.versionInfo(targetId);selected=undefined;feedbackPreview=targetId;
              for(const git of info.git){try{if(timelineId(await history.version(root,git.hash))===targetId){selected=git.hash;feedbackPreview=undefined;break;}}catch{}}
            }
            await display(target,undefined,selected);
          }catch(error){selected=previous.selected;feedbackPreview=previous.feedbackPreview;throw error;}
        }
        if(store!==feedback||ticket!==feedbackNavigation||!shown||timelineId(shown)!==targetId)throw Error('버전이 바뀌어 이동을 취소했습니다.');
        await send({type:'feedbackSeek',requestId,viewVersionId:targetId,renderRevision:revision,start:navigation.resolution.start,end:navigation.resolution.end,threadId:m.threadId});
        return;
      }
      const input=m.input;
      if(!input||input.requestId!==requestId)throw Error('잘못된 피드백 요청입니다.');
      if(input.action==='create'||input.action==='relink'){
        if(m.viewVersionId!==docId||m.viewRevision!==revision||input.versionId!==docId)throw Error('편집 버전이 바뀌었습니다. 위치를 다시 지정하세요.');
        if(!selected&&!feedbackPreview&&timelineId(await readTimeline(root))!==docId)throw Error('편집 내용이 바뀌었습니다. 새 화면에서 위치를 다시 지정하세요.');
      }
      const state=await store.mutate(input,t,hint);
      if(store===feedback)await send({type:'feedbackResult',requestId,ok:true,action:input.action,state,viewVersionId:docId,renderRevision:revision,preview:!!(selected||feedbackPreview)});
    }catch(error){
      if(store!==feedback)return;
      await send({type:'feedbackResult',requestId,ok:false,code:error instanceof FeedbackConflict?'conflict':'validation',message:error instanceof Error?error.message:String(error)});
      void publishFeedback();
    }
  }
  async function display(t:Timeline,diff?:ReturnType<typeof diffTimeline>,version?:string) {
    const token=++revision;
    await send({type:'status',message:'Checking sources and preparing playback proxies…'});
    const checklist=await checkProject(root,t);
    if(token!==revision)return;
    await send({type:'checklist',report:checklist});
    const proxies:Record<string,string>={};
    for(const source of new Set(t.clips.map(c=>c.source))) {
      if(token!==revision)return;
      try{const file=await ensureProxy(root,source,proxyFormat,message=>{if(token===revision)void send({type:'status',message:`${source} · ${message}`});});
      if(!panel)return;
      proxies[source]=playback!.url(file);}catch(e){if(token===revision)await fail(e);}
    }
    const text=await transcripts(root);
    if(token!==revision||!panel)return;
    shown=t;shownVersion=version||(feedbackPreview?'local-'+feedbackPreview:undefined);lastDiff=diff;
    const assets=await prepareSequenceAssets(root,t,proxyFormat,file=>playback!.url(file),message=>{if(token===revision)void send({type:'status',message});});
    if(token!==revision||!panel)return;
    const message={type:'timeline',revision:token,timeline:t,diff,proxies,transcripts:text,version:shownVersion,canRestoreVersion:!!version,timelineId:timelineId(t),format:proxyFormat,assets,projectName:path.basename(root)};
    record({type:'sent',message});await send(message);await listVersions();void publishFeedback(t,version);
  }
  async function reload() {
    if(!ready)return;
    const request=++loadRequest;
    try {
      const next=await readTimeline(root);
      const checklist=await checkProject(root,(selected||feedbackPreview)&&shown?shown:next);
      if(request!==loadRequest)return;
      await send({type:'checklist',report:checklist});
      try{await validateMedia(root,next);}catch(e){if(!selected&&!feedbackPreview)await display(next);await fail(e);return;}
      if(request!==loadRequest)return;
      const old=shown;current=next;
      await send({type:'clearError'});
      if(agentBefore){editQueue=editQueue.catch(()=>{}).then(()=>captureAgent(next));await editQueue;}
      const references=await readReferences(root);
      const metadata=await validateMedia(root,next);
      for(const reference of references)for(const [source,meta] of await validateMedia(root,reference.timeline))metadata.set(source,meta);
      if(request!==loadRequest)return;
      const signalWindows=new Map(await Promise.all([...metadata.keys()].map(async s=>[s,await readSignalWindows(root,s)] as const)));
      const comparisons=references.length?references:[{name:'원본 시간축 · 사람 편집본 없음',timeline:{version:1 as const,clips:[]}}];
      await send({type:'references',items:comparisons.map(r=>({name:r.name,hasHuman:references.length>0,metrics:referenceMetrics(next,r.timeline),sources:[...metadata].map(([source,meta])=>({source,duration:meta.duration,ai:kept(next,source),human:kept(r.timeline,source),signals:signalWindows.get(source)}))}))});
      if(selected||feedbackPreview) {await send({type:'status',message:'Current file changed. Viewing history; choose Current to return.'});await listVersions();void publishFeedback();return;}
      if(!old||shownVersion||!same(old,next))await display(next,old?diffTimeline(old,next):undefined);
      else {await listVersions();void publishFeedback();}
    } catch(e) {if(request===loadRequest){await send({type:'checklistUnavailable'});await fail(e);}}
  }
  async function open(folder?:string) {
    if(panel){panel.reveal(vscode.ViewColumn.One);return;}
    if(agent||finishing)throw Error('에이전트 종료를 기다린 후 패널을 다시 여세요');
    edits.clear();
    root=folder??await getRoot();current=undefined;shown=undefined;selected=undefined;feedbackPreview=undefined;ready=false;feedback=new FeedbackStore(root);++feedbackNavigation;
    const helperChat:HelperChat=new HelperChat(context.workspaceState.get('beginnerHelper'),async state=>{if(helper===helperChat)await context.workspaceState.update('beginnerHelper',state);},state=>{if(helper===helperChat)void send({type:'helperState',state});},()=>new AgentRun(context.extensionMode===vscode.ExtensionMode.Test&&process.env.CUTLINE_HELPER_TEST_NODE&&process.env.CUTLINE_HELPER_TEST_CLI?async()=>({file:process.env.CUTLINE_HELPER_TEST_NODE!,prefix:[process.env.CUTLINE_HELPER_TEST_CLI!]}):undefined));helper=helperChat;
    const transport=await playbackServer();
    const existingPanel=panel as vscode.WebviewPanel|undefined;
    if(existingPanel){transport.dispose();existingPanel.reveal(vscode.ViewColumn.One);return;}
    playback=transport;
    panel=vscode.window.createWebviewPanel('cutline.video',BRAND,vscode.ViewColumn.One,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.file(cacheDirectory(root)),vscode.Uri.file(path.join(root,'sources')),vscode.Uri.joinPath(context.extensionUri,'media')]});
    panel.webview.html=html(panel.webview,context.extensionUri,playback.origin);
    panel.onDidDispose(()=>{void agent?.stop();void helper?.stop();helper=undefined;transport.dispose();playback=undefined;panel=undefined;ready=false;feedback=undefined;++feedbackNavigation;++feedbackLoad;++revision;if(timer)clearTimeout(timer);if(feedbackTimer)clearTimeout(feedbackTimer);watchers.forEach(w=>w.dispose());watchers=[];});
    const watch=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'timeline.json'));
    const schedule=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>void reload(),180);};
    watchers.push(watch,watch.onDidChange(schedule),watch.onDidCreate(schedule),watch.onDidDelete(schedule));
    const tw=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'transcripts/**/*.json'));
    watchers.push(tw,tw.onDidChange(schedule),tw.onDidCreate(schedule),tw.onDidDelete(schedule));
    const sw=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'{edit-spec.json,style.md,sources/**,signals/**/*.json}'));
    watchers.push(sw,sw.onDidChange(schedule),sw.onDidCreate(schedule),sw.onDidDelete(schedule));
    const rw=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'reference/*.timeline.json'));
    watchers.push(rw,rw.onDidChange(schedule),rw.onDidCreate(schedule),rw.onDidDelete(schedule));
    const fw=vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root,'.cutline/feedback/state.json'));
    const feedbackRefresh=()=>{if(feedbackTimer)clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>void publishFeedback(),120);};
    watchers.push(fw,fw.onDidChange(feedbackRefresh),fw.onDidCreate(feedbackRefresh),fw.onDidDelete(feedbackRefresh));
    panel.webview.onDidReceiveMessage(async m=>{
      record(m);
      if(m.type==='playback')output.info(JSON.stringify({root,...m}));
      if(m.type==='checklistApplied')output.info(JSON.stringify({root,...m}));
      if(m.type==='referencesApplied')output.info(JSON.stringify({root,...m}));
      if(m.type==='layout')output.info(JSON.stringify({root,...m}));
      try {
        if(m.type==='feedbackRequest'){void handleFeedback(m);return;}
        if(['helperToggle','helperSend','helperStop','helperNew'].includes(m.type)){
          const active=helper;if(!active)return;
          try{
            if(m.type==='helperToggle'){if(typeof m.enabled!=='boolean')throw Error('도우미 설정을 확인하세요.');await active.setEnabled(m.enabled);}
            if(m.type==='helperStop')await active.stop();
            if(m.type==='helperNew')await active.clear();
            if(m.type==='helperSend'){await fs.mkdir(helperDirectory,{recursive:true});void active.ask(m.prompt,m.backend,{project:path.basename(root),timeline:shown?structuredClone(shown):undefined,time:m.time,preview:!!(selected||feedbackPreview)},helperDirectory).catch(error=>{if(helper===active)void send({type:'helperError',message:String(error)});});}
          }catch(error){await send({type:'helperError',message:error instanceof Error?error.message:String(error)});}return;
        }
        if(m.type==='ready'){ready=true;let chips;try{chips=await prompts(root);}catch(e){await chat({kind:'error',text:String(e)});}await send({type:'chatInit',backend,prompts:chips});if(helper)await send({type:'helperState',state:helper.view()});await reload();}
        if(m.type==='agentSend')void startAgent(m.prompt,m.backend).catch(e=>chat({kind:'error',text:String(e)}));
        if(m.type==='agentStop')await agent?.stop();
        if(m.type==='agentBackend'&&(m.backend==='claude'||m.backend==='codex')){backend=m.backend;await context.globalState.update('agentBackend',backend);}
        if(m.type==='agentNew'&&!agent){delete sessions[backend];await context.workspaceState.update('agentSessions',sessions);await chat({kind:'step',text:'새 대화를 시작합니다'});}
        if(m.type==='sequenceImport'||m.type==='voiceover'){
          if(agent||selected||feedbackPreview)throw Error('에이전트 완료 후 Current에서 편집하세요');
          if(m.revision!==revision)throw Error('타임라인이 변경되었습니다. 다시 시도하세요');
          const folder=path.join(root,'sources');await fs.mkdir(folder,{recursive:true});
          let source:string;
          if(m.type==='voiceover'){
            if(typeof m.data!=='string'||m.data.length>70_000_000)throw Error('녹음 파일은 50MB 이하만 지원합니다');
            const name='voiceover-'+randomBytes(8).toString('hex')+'.webm';source='sources/'+name;await fs.writeFile(path.join(folder,name),Buffer.from(m.data,'base64'),{flag:'wx'});
          }else{
            const files=await vscode.window.showOpenDialog({canSelectMany:false,filters:{'영상 · 오디오':['mp4','mov','mkv','webm','avi','m4v','mp3','wav','m4a','aac','ogg','flac']}});
            if(!files?.length){await send({type:'editState',...edits.state});return;}
            const from=files[0].fsPath,extension=path.extname(from),name=path.basename(from,extension)+'-'+randomBytes(4).toString('hex')+extension;source='sources/'+name;await fs.copyFile(from,path.join(folder,name),1);
          }
          const meta=await probe(await sourcePath(root,source),true),before=await readTimeline(root),seq=sequenceModel.fromTimeline(before),kind=m.type==='voiceover'||!meta.video?'audio':'video';
          const target=seq.tracks.find(t=>t.id===m.trackId&&t.kind===kind&&!t.locked)??seq.tracks.find(t=>t.kind===kind&&t.sourceTarget&&!t.locked)??seq.tracks.find(t=>t.kind===kind&&!t.locked);
          if(!target)throw Error('잠금이 해제된 대상 트랙이 없습니다');
          const start=Number.isFinite(m.time)?Math.max(0,m.time):0,id='media-'+randomBytes(8).toString('hex');
          const items:any[]=[{id,kind,source,trackId:target.id,start,in:0,out:meta.duration,name:path.basename(source),...(kind==='video'?{linkGroup:id}:{gainDb:0,automation:[]})}];
          if(kind==='video'&&meta.audio){const audio=seq.tracks.find(t=>t.kind==='audio'&&t.sourceTarget&&!t.locked)??seq.tracks.find(t=>t.kind==='audio'&&!t.locked);if(audio)items.push({...items[0],id:'audio-'+randomBytes(8).toString('hex'),kind:'audio',trackId:audio.id,linkGroup:id,gainDb:0,automation:[]});}
          editQueue=editQueue.catch(()=>{}).then(()=>edits.apply(root,{action:'sequence',operation:{action:'insert',items}},t=>validateMedia(root,t)));
          await editQueue;await reload();await send({type:'editState',...edits.state});
        }
        if(m.type==='manual'){
          if(agent||selected||feedbackPreview)throw Error('에이전트 완료 후 Current에서 편집하세요');
          if(m.revision!==revision)throw Error('타임라인이 변경되었습니다. 최신 화면에서 다시 편집하세요');
          editQueue=editQueue.catch(()=>{}).then(()=>edits.apply(root,m,t=>validateMedia(root,t)));
          await editQueue;await reload();await send({type:'editState',...edits.state});
        }
        if(m.type==='playback'&&m.event==='error'&&m.revision===revision&&proxyFormat==='webm'&&shown) {
          proxyFormat='mp4';await send({type:'status',message:'This VS Code cannot decode WebM. Preparing H.264/MP3 compatibility proxies…'});
          await display(shown,lastDiff,selected);
        }
        if(m.type==='playback'&&m.event==='canplay'&&m.revision===revision)await context.workspaceState.update('proxyFormat',proxyFormat);
        if(m.type==='current'){selected=undefined;feedbackPreview=undefined;++feedbackNavigation;await reload();}
        if(m.type==='versions'){await listVersions();void publishFeedback();}
        if(m.type==='preview') {const t=await history.version(root,m.hash);feedbackPreview=undefined;++feedbackNavigation;await display(t,undefined,m.hash);selected=m.hash;}
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
    const file=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`${BRAND}: Exporting originals`},()=>readTimeline(folder).then(t=>exportTimeline(folder,t,async report=>(await vscode.window.showWarningMessage(report.summary+'\n필수 검증 FAIL이 있습니다. 그래도 내보낼까요?',{modal:true},'내보내기'))==='내보내기')));
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
function html(webview:vscode.Webview,uri:vscode.Uri,playbackOrigin:string) {
  const nonce=randomBytes(16).toString('hex');
  const script=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','panel.js'));
  const style=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','panel.css'));
  const timelineStyle=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','timeline.css'));
  const model=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','sequence-model.js'));
  const timelineScript=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','timeline.js'));
  const feedbackStyle=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','feedback.css'));
  const feedbackScript=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','feedback.js'));
  const helperStyle=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','helper.css'));
  const helperScript=webview.asWebviewUri(vscode.Uri.joinPath(uri,'media','helper.js'));
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} ${playbackOrigin} data:; connect-src ${playbackOrigin}; media-src ${webview.cspSource} ${playbackOrigin} blob:;"><link rel="stylesheet" href="${style}"><link rel="stylesheet" href="${timelineStyle}"><link rel="stylesheet" href="${feedbackStyle}"><link rel="stylesheet" href="${helperStyle}"></head><body>
  <header><b>${BRAND}</b><span class="badge">AGENT VIDEO WORKSPACE</span><button id="toggle-chat" title="에이전트 채팅 접기/펼치기" aria-expanded="true">채팅</button><button id="toggle-feedback" title="우측 편집 피드백 패널 열기/닫기" aria-expanded="false">피드백</button><button id="export">Export MP4</button></header>
  <div class="workspace"><aside id="chat" aria-label="Agent chat"><div class="chat-heading"><b>편집 에이전트</b><select id="backend" aria-label="Agent backend"><option value="claude">Claude</option><option value="codex">Codex</option></select><button id="new-chat" title="새 대화">＋</button></div><div class="helper-mode-row"><span>초보자 도우미</span><button id="helper-toggle" type="button" role="switch" aria-checked="false" aria-label="초보자 도우미 켜기/끄기"><span class="helper-switch" aria-hidden="true"></span><span class="helper-toggle-label">꺼짐</span></button></div><section id="helper-panel" aria-label="초보자 도우미 채팅" hidden></section><p class="chat-hint">원하는 편집을 말해 주세요.<br>내 구독으로 편집하고, 변경은 영상에 바로 반영됩니다.</p><div id="messages" role="log" aria-live="polite"></div><div id="chips"></div><form id="chat-form"><textarea id="prompt" aria-label="편집 요청" placeholder="어떤 영상을 만들까요?" rows="3" maxlength="20000"></textarea><div class="chat-actions"><span id="elapsed">준비됨</span><button id="stop" type="button" disabled>중단</button><button id="send" type="submit">보내기 ↑</button></div></form></aside><div class="video-workspace"><div id="banner" role="status">Waiting for timeline.json</div><div id="error" role="alert" hidden></div>
  <main><div class="monitor-area"><details id="checklist"><summary id="check-summary">검증 중…</summary><div id="check-results"></div></details><section class="preview"><video id="video" preload="auto" playsinline></video><canvas id="sequence-preview" width="1280" height="720" hidden aria-label="합성 영상 미리보기"></canvas><div id="empty" hidden>No clips. Ask your agent to build a timeline.</div></section>
  <div class="transport"><button id="play">▶ Play</button><button id="previous">⏮</button><button id="next">⏭</button><span id="time">00:00 / 00:00</span><span id="clip"></span></div>
  <input id="scrub" type="range" min="0" max="1" step="0.01" value="0" aria-label="Timeline position"></div>
  <section id="editing-workspace" aria-label="멀티트랙 편집 타임라인"></section><div id="timeline" hidden></div><div class="edit-tools" hidden><button id="split">분할 S</button><button id="delete">삭제 Del</button><button id="undo" disabled>↶ 되돌리기</button><button id="redo" disabled>↷ 다시 실행</button></div><details class="inspection-area"><summary>비교 · 대본 · 버전 기록</summary><div id="ghosts"></div><p id="reason"></p>
  <section id="references" hidden aria-label="Human versus AI original time comparison"></section><details><summary>대본 · 버전 기록</summary><div class="columns"><section><div class="section-title">TRANSCRIPT · click to seek</div><div id="transcript"></div></section><section><div class="section-title">VERSIONS <button id="refresh">↻</button></div><button id="current">Current</button><button id="compare">Diff vs current</button><button id="restore" disabled>Restore</button><div id="version-label"></div><div id="versions"></div></section></div></details></details></main></div><aside id="feedback-panel" aria-label="편집 피드백 협업 패널" aria-hidden="true"></aside></div><script nonce="${nonce}" src="${model}"></script><script nonce="${nonce}" src="${timelineScript}"></script><script nonce="${nonce}" src="${feedbackScript}"></script><script nonce="${nonce}" src="${helperScript}"></script><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
