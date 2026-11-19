// Real subscription smoke test. All copied credentials, sessions and project writes stay ignored.
const fs=require('node:fs/promises'),path=require('node:path');
const {runTests}=require('@vscode/test-electron');
const {run}=require('../out/media');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=path.join(root,'.test-data/real-agent'),project=path.join(data,'project');
 await fs.mkdir(data,{recursive:true});await fs.mkdir(project,{recursive:true});
 for(const name of ['sources','transcripts','timeline.json','style.md'])await fs.cp(path.join(root,'sample-project',name),path.join(project,name),{recursive:true});
 await fs.writeFile(path.join(project,'AGENTS.md'),'Edit only timeline.json. Never change sources. Never push. Do not delegate.');
 await fs.mkdir(path.join(project,'tools'),{recursive:true});await fs.mkdir(path.join(project,'out'),{recursive:true});
 await fs.copyFile(path.join(root,'tools/vidcli.js'),path.join(project,'tools/vidcli.js'));
 await fs.copyFile(path.join(root,'tools/compare.js'),path.join(project,'tools/compare.js'));
 await fs.mkdir(path.join(project,'reference'),{recursive:true});await fs.copyFile(path.join(root,'sample-project/timeline.json'),path.join(project,'reference/sample.timeline.json'));
 for(const name of await fs.readdir(path.join(root,'out')))if(name.endsWith('.js'))await fs.copyFile(path.join(root,'out',name),path.join(project,'out',name));
 await run('git',['init'],project);await run('git',['config','user.name','Cutline Test'],project);await run('git',['config','user.email','test@cutline.invalid'],project);await run('git',['config','commit.gpgsign','false'],project);
 await run('git',['add','timeline.json'],project);await run('git',['commit','--allow-empty','-m','Test baseline'],project);
 const claudeHome=path.join(data,'claude-home'),codexHome=path.join(data,'codex-home');await fs.mkdir(claudeHome,{recursive:true});await fs.mkdir(codexHome,{recursive:true});
 await fs.copyFile(path.join(process.env.USERPROFILE,'.claude/.credentials.json'),path.join(claudeHome,'.credentials.json'));
 await fs.copyFile(path.join(process.env.CODEX_HOME||path.join(process.env.USERPROFILE,'.codex'),'auth.json'),path.join(codexHome,'auth.json'));
 const user=path.join(data,'user/User');await fs.mkdir(user,{recursive:true});
 await fs.writeFile(path.join(user,'settings.json'),JSON.stringify({'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoUpdate':false,'workbench.startupEditor':'none','cutline.openTerminal':false,'cutline.codexSandbox':process.env.CUTLINE_TEST_SANDBOX||'danger-full-access'}));
 const temp=path.join(data,'temp');await fs.mkdir(temp,{recursive:true});
 process.env.TEMP=temp;process.env.TMP=temp;process.env.NODE_DISABLE_COMPILE_CACHE='1';
 const trace=path.join(data,'trace');await fs.mkdir(trace,{recursive:true});
 try{await runTests({vscodeExecutablePath:process.env.CUTLINE_VSCODE||'D:/Microsoft VS Code/Code.exe',extensionDevelopmentPath:root,extensionTestsPath:path.join(root,'out/test/real-agent.js'),launchArgs:[project,'--user-data-dir',path.join(data,'user'),'--extensions-dir',path.join(data,'extensions'),'--disable-extensions','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--disable-telemetry'],extensionTestsEnv:{CUTLINE_TEST_ROOT:root,CLAUDE_CONFIG_DIR:claudeHome,CODEX_HOME:codexHome,CUTLINE_AGENT_TRACE:trace}});}
 finally{await fs.rm(path.join(claudeHome,'.credentials.json'),{force:true});await fs.rm(path.join(codexHome,'auth.json'),{force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
