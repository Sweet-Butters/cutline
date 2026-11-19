import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {runTests} from '@vscode/test-electron';
async function main(){
  const root=path.resolve(__dirname,'../..');const data=path.join(root,'.test-data');await fs.mkdir(data,{recursive:true});
  const temp=path.join(data,'temp');await fs.mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
  await runTests({vscodeExecutablePath:process.env.CUTLINE_VSCODE||'D:/Microsoft VS Code/Code.exe',extensionDevelopmentPath:root,extensionTestsPath:path.join(root,'out/test/integration.js'),launchArgs:[path.join(root,'sample-project'),'--user-data-dir',path.join(data,'vscode-user'),'--extensions-dir',path.join(data,'vscode-extensions'),'--disable-extensions','--skip-welcome','--skip-release-notes','--disable-workspace-trust','--disable-updates','--disable-telemetry'],extensionTestsEnv:{CUTLINE_TEST_ROOT:root}});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
