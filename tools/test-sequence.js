/* Isolated UI fixture: never edits the user's currently open project. */
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),data=path.join(root,'.test-data');fs.mkdirSync(data,{recursive:true});
const fixture=fs.mkdtempSync(path.join(data,'sequence-gui-')),project=path.join(fixture,'project');fs.mkdirSync(project);fs.mkdirSync(path.join(project,'sources'));
for(const name of ['camera-1.mp4','camera-2.mp4'])fs.copyFileSync(path.join(root,'sample-project/sources',name),path.join(project,'sources',name));
const cache=path.join(root,'sample-project/.cutline-cache');if(fs.existsSync(cache))fs.symlinkSync(cache,path.join(project,'.cutline-cache'),process.platform==='win32'?'junction':'dir');
fs.writeFileSync(path.join(project,'timeline.json'),JSON.stringify({version:1,clips:[{id:'first',source:'sources/camera-1.mp4',in:0,out:4,reason:'첫 장면'},{id:'second',source:'sources/camera-2.mp4',in:0,out:4,reason:'두 번째 장면'}]},null,2));
const user=path.join(fixture,'user-data/User');fs.mkdirSync(user,{recursive:true});fs.writeFileSync(path.join(user,'settings.json'),JSON.stringify({'telemetry.telemetryLevel':'off','workbench.startupEditor':'none','update.mode':'none','extensions.autoUpdate':false,'chat.disableAIFeatures':true,'window.zoomLevel':0,'git.openRepositoryInParentFolders':'never'}));
const result=path.join(root,'test-results/sequence-integration-report.json'),screenshot=path.join(root,'test-results/sequence-timeline-ui.png'),port=19000+Math.floor(Math.random()*1000);fs.mkdirSync(path.dirname(result),{recursive:true});
const binary=process.env.CUTLINE_VSCODE||(process.platform==='darwin'?'/Applications/Visual Studio Code.app/Contents/MacOS/Code':undefined);if(!binary)throw Error('Set CUTLINE_VSCODE to the editor executable');
const env={...process.env,CUTLINE_SEQUENCE_RESULT:result,CUTLINE_SEQUENCE_SCREENSHOT:screenshot,CUTLINE_SEQUENCE_DEBUG_PORT:String(port)};delete env.ELECTRON_RUN_AS_NODE;delete env.VSCODE_IPC_HOOK_CLI;delete env.VSCODE_PID;
const log=fs.openSync(path.join(fixture,'host.log'),'w');const child=spawnSync(binary,[project,'--user-data-dir',path.join(fixture,'user-data'),'--extensions-dir',path.join(fixture,'extensions'),'--extensionDevelopmentPath='+root,'--extensionTestsPath='+path.join(root,'out/test/sequence-integration.js'),'--disable-extensions','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--disable-telemetry','--autoplay-policy=no-user-gesture-required','--mute-audio','--remote-debugging-port='+port],{env,stdio:['ignore',log,log],timeout:180000});fs.closeSync(log);
if(fs.existsSync(result)){const report=JSON.parse(fs.readFileSync(result,'utf8'));console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,events:report.events,fixture,screenshot},null,2));if(!report.passed)process.exitCode=1;}else{console.error('Editor exited without a sequence report',child.status,child.error?.message,'Log:',path.join(fixture,'host.log'));process.exitCode=1;}
if(child.status!==0)process.exitCode=1;
