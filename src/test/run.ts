import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {runTests} from '@vscode/test-electron';
async function main(){
  const root=path.resolve(__dirname,'../..');const data=path.join(root,'.test-data');await fs.mkdir(data,{recursive:true});
  const temp=path.join(data,'temp');await fs.mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
  process.env.NODE_DISABLE_COMPILE_CACHE='1';
  const user=path.join(data,'vscode-user','User');await fs.mkdir(user,{recursive:true});
  await fs.writeFile(path.join(user,'settings.json'),JSON.stringify({'chat.disableAIFeatures':true,'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoUpdate':false,'extensions.autoCheckUpdates':false,'workbench.startupEditor':'none','git.openRepositoryInParentFolders':'never'}));
  await runTests({vscodeExecutablePath:process.env.CUTLINE_VSCODE||'D:/Microsoft VS Code/Code.exe',extensionDevelopmentPath:process.env.CUTLINE_EXTENSION_PATH||root,extensionTestsPath:path.join(root,'out/test/integration.js'),launchArgs:[path.join(root,'sample-project'),'--user-data-dir',path.join(data,'vscode-user'),'--extensions-dir',path.join(data,'vscode-extensions'),'--disable-extensions','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--disable-telemetry'],extensionTestsEnv:{CUTLINE_TEST_ROOT:root}});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
