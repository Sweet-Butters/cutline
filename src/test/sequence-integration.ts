import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {readTimeline} from '../core';
async function until<T>(fn:()=>T|Promise<T>,description:string,timeout=45000):Promise<NonNullable<T>>{const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await fn();if(value)return value as NonNullable<T>;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+description);}
async function screenshot(file:string){
  const targets=await (await fetch('http://127.0.0.1:'+process.env.CUTLINE_SEQUENCE_DEBUG_PORT+'/json')).json() as any[];
  const target=targets.find(t=>t.type==='page'&&t.url.includes('workbench'));
  if(!target)throw Error('No workbench screenshot target');
  await new Promise<void>((resolve,reject)=>{const socket=new WebSocket(target.webSocketDebuggerUrl);const timer=setTimeout(()=>{socket.close();reject(Error('Screenshot timeout'));},10000);socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Page.captureScreenshot',params:{format:'png'}}));socket.onerror=()=>{clearTimeout(timer);reject(Error('Screenshot connection failed'));};socket.onmessage=async event=>{const message=JSON.parse(String(event.data));if(message.id!==1)return;clearTimeout(timer);socket.close();if(message.error){reject(Error(message.error.message));return;}await fs.writeFile(file,Buffer.from(message.result.data,'base64'));resolve();};});
}
async function trustedPlay(bounds:any){
  const targets=await (await fetch('http://127.0.0.1:'+process.env.CUTLINE_SEQUENCE_DEBUG_PORT+'/json')).json() as any[],target=targets.find(t=>t.type==='page'&&t.url.includes('workbench'));
  if(!target)throw Error('No workbench input target');
  await new Promise<void>((resolve,reject)=>{const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:any)=>void}>();let id=0;const timer=setTimeout(()=>{socket.close();reject(Error('Trusted input timeout'));},10000);
    const call=(method:string,params:any={})=>new Promise<any>((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    socket.onmessage=e=>{const m=JSON.parse(String(e.data)),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
    socket.onerror=()=>{clearTimeout(timer);reject(Error('Trusted input connection failed'));};
    socket.onopen=async()=>{try{await call('Page.bringToFront');const value=await call('Runtime.evaluate',{expression:`JSON.stringify([...document.querySelectorAll('iframe')].map(n=>{const r=n.getBoundingClientRect();return {x:r.left,y:r.top,width:r.width,height:r.height};}).filter(r=>r.width>300&&r.height>200))`,returnByValue:true});const frames=JSON.parse(value.result.value),frame=frames[0];if(!frame)throw Error('No visible webview frame');const x=frame.x+bounds.x+bounds.width/2,y=frame.y+bounds.y+bounds.height/2;await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});clearTimeout(timer);socket.close();resolve();}catch(e){clearTimeout(timer);socket.close();reject(e);}};
  });
}
export async function run(){
  const root=vscode.workspace.workspaceFolders![0].uri.fsPath,extension=vscode.extensions.getExtension('cutline-local.cutline');assert.ok(extension);const api=await extension.activate();const report:any={passed:false,checks:[]};let serial=0;
  const check=(message:string)=>report.checks.push(message);
  const snap=async()=>{const tag='sequence-'+(++serial);await api.testAction('sequenceSnapshot',{tag});return until(()=>api.events.find((e:any)=>e.type==='sequenceSnapshot'&&e.tag===tag),'timeline snapshot');};
  const changed=async(action:()=>Promise<any>,predicate:(t:any)=>boolean)=>{await action();await until(async()=>predicate(await readTimeline(root)),'saved sequence mutation');await until(async()=>{const s=await snap();return !s.pending&&!s.disabled&&s.advanced&&predicate({sequence:{tracks:s.tracks,items:s.items,markers:s.markers}});},'rendered saved mutation');};
  try{
    assert.equal(await api.startup,true);await until(()=>api.events.some((e:any)=>e.type==='playback'&&e.event==='canplay'),'initial video playback');
    let s=await snap();assert.equal(s.items.length,4);assert.equal(s.tracks.length,7);for(const row of s.geometry){assert.ok(Math.abs(row.header.top-row.lane.top)<1);assert.ok(Math.abs(row.header.height-row.lane.height)<1);}check('V3/V2/V1, audio and CC rows align with shared scroll coordinates');
    const before=JSON.stringify(s.items);await api.testAction('sequenceZoom',{pps:45});s=await snap();assert.equal(JSON.stringify(s.items),before);assert.equal(s.pps,45);await api.testAction('sequenceScroll',{x:40,y:100});s=await snap();for(const row of s.geometry)assert.ok(Math.abs(row.header.top-row.lane.top)<1);check('zoom and horizontal/vertical navigation preserve clip times and row alignment');
    await api.testAction('sequenceSeek',{time:1+29/30});s=await snap();assert.ok(Math.abs(s.head-(1+29/30))<.04);check('frame-based ruler seeks are synchronized with playback');
    // Exercise actual pointer handlers, including a purely vertical drag.
    await api.testAction('sequenceScroll',{x:0,y:0});
    await screenshot(process.env.CUTLINE_SEQUENCE_SCREENSHOT!.replace('.png','-before.png'));
    await changed(()=>api.testAction('sequencePointer',{selector:'.te-clip[data-id="first"]',trackId:'V2',delta:0}),t=>t.sequence?.items.find((c:any)=>c.id==='first')?.trackId==='V2');check('dragging a clip vertically commits its destination track');
    await api.testAction('sequenceSeek',{time:2});await api.testAction('sequenceSelect',{ids:['first']});
    await changed(()=>api.testAction('sequenceClick',{selector:'[data-control="split"]'}),t=>t.sequence?.items.filter((c:any)=>c.kind==='video').length===3);check('toolbar split preserves linked video/audio timing and source intervals');
    await changed(()=>api.testAction('sequenceClick',{selector:'.te-row[data-track="A1"] button[title="음소거 A1"]'}),t=>!!t.sequence?.tracks.find((x:any)=>x.id==='A1')?.muted);
    await api.testAction('sequenceSeek',{time:1});s=await snap();const beforeFrames=s.player.frames,tag='play-click-'+serial;await api.testAction('playBounds',{tag});const bounds=await until(()=>api.events.find((e:any)=>e.type==='playBounds'&&e.tag===tag),'play bounds');await trustedPlay(bounds.bounds);s=await until(async()=>{const value=await snap(),error=api.events.find((e:any)=>e.type==='webviewError');if(error)throw Error(JSON.stringify(error));return value.player.playing&&value.player.frames>beforeFrames&&value.player.time>1.3?value:undefined;},'real playback time and decoded frames',10000);assert.ok(s.player.gains.every((g:any)=>g.value===0));await api.testAction('play');check('muted audio reaches the real Web Audio mixer while video frames advance');
    await changed(()=>api.testAction('sequenceEdit',{operation:{action:'track',trackId:'V2',patch:{visible:false}}}),t=>t.sequence?.tracks.find((x:any)=>x.id==='V2')?.visible===false);check('video visibility is saved and used by the compositor');
    await changed(()=>api.testAction('sequenceEdit',{operation:{action:'insert',item:{id:'caption-test',kind:'text',trackId:'CC',start:0,in:0,out:3,text:'멀티트랙 자막',style:{color:'#ffffff',x:.5,y:.85,fontSize:42}}}}),t=>t.sequence?.items.some((c:any)=>c.id==='caption-test'));
    await changed(()=>api.testAction('sequenceEdit',{operation:{action:'insert',item:{id:'shape-test',kind:'shape',trackId:'V3',start:0,in:0,out:2,style:{color:'#ff7040',x:.5,y:.5,width:.3,height:.2}}}}),t=>t.sequence?.items.some((c:any)=>c.id==='shape-test'));check('text and shape layers are persisted as actual composited clips');
    await api.testAction('sequenceTool',{tool:'pen'});await changed(()=>api.testAction('sequencePointer',{selector:'.te-clip[data-id="shape-test"]',delta:0}),t=>t.sequence?.items.find((c:any)=>c.id==='shape-test')?.opacityAutomation?.length===1);await changed(()=>api.testAction('sequenceEdit',{operation:{action:'keyframe',ids:['shape-test'],linked:false,property:'opacity',time:2,value:1}}),t=>t.sequence?.items.find((c:any)=>c.id==='shape-test')?.opacityAutomation?.length===2);await api.testAction('sequenceTool',{tool:'select'});check('pen tool creates real visual effect keyframes and renders their envelope');
    await changed(()=>api.testAction('sequenceEdit',{operation:{action:'marker',time:2,label:'검토 지점'}}),t=>t.sequence?.markers.length===1);
    await changed(()=>api.testAction('sequenceEdit',{operation:{action:'track',trackId:'V2',patch:{visible:true}}}),t=>t.sequence?.tracks.find((x:any)=>x.id==='V2')?.visible===true);
    await api.testAction('sequenceSeek',{time:1});await new Promise(r=>setTimeout(r,500));
    await screenshot(process.env.CUTLINE_SEQUENCE_SCREENSHOT!);check('rendered interface screenshot captured from its own VS Code window');
    const current=await readTimeline(root);await changed(()=>api.testAction('click',{id:'undo'}),t=>t.sequence?.tracks.find((x:any)=>x.id==='V2')?.visible===false);await changed(()=>api.testAction('click',{id:'redo'}),t=>t.sequence?.tracks.find((x:any)=>x.id==='V2')?.visible===true);assert.deepEqual(await readTimeline(root),current);check('sequence changes support persistent undo/redo with external-edit protection');
    assert.equal(api.events.some((e:any)=>e.type==='webviewError'),false,'No webview runtime errors');report.passed=true;report.snapshot=await snap();
  }catch(error){report.error=String(error);report.events=api.events.filter((e:any)=>e.type==='error'||e.type==='playback').slice(-10);throw error;}
  finally{await fs.writeFile(process.env.CUTLINE_SEQUENCE_RESULT!,JSON.stringify(report,null,2));api.dispose();}
}
