import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {AgentRun,command,subscriptionEnv,JsonLines,prompts,resolveCLI} from '../agent';
import {recordAgentEdit,EditSession,manualEdit} from '../editing';
import {Timeline,readTimeline,writeTimeline} from '../core';
import {versions} from '../history';
import {run} from '../media';
const root=path.resolve(__dirname,'../..');
const timeline=():Timeline=>({version:1,clips:[{id:'a',source:'sources/a.mp4',in:0,out:10},{id:'b',source:'sources/a.mp4',in:10,out:20}]});
test('CLI failures reach chat and Stop terminates the descendant process too',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'.test-data/process-')),script=path.join(dir,'fake.js');
  await fs.writeFile(script,'process.stderr.write("Not logged in");process.exitCode=7;');
  const resolver=async()=>({file:process.execPath,prefix:[script]});
  await assert.rejects(new AgentRun(resolver).run(dir,'claude','test',()=>{}),/Not logged in.*exit 7/);
  await fs.writeFile(script,`const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true});require('node:fs').writeFileSync('child.pid',String(p.pid));setInterval(()=>{},1000);`);
  const agent=new AgentRun(resolver),pending=agent.run(dir,'claude','test',()=>{});let pid=0;
  for(let i=0;i<100&&!pid;i++){await new Promise(r=>setTimeout(r,25));pid=Number(await fs.readFile(path.join(dir,'child.pid'),'utf8').catch(()=>0));}
  assert.ok(pid);await agent.stop();assert.equal((await pending).stopped,true);
  let alive=true;for(let i=0;i<40&&alive;i++){try{process.kill(pid,0);await new Promise(r=>setTimeout(r,25));}catch{alive=false;}}
  assert.equal(alive,false,'child process tree is terminated');
});
test('subscription CLI command uses exact arguments, scoped tools, and explicit resume',()=>{
  const prompt='" & echo injected $(whoami)\n한글';
  const claude=command('claude',prompt,'session');assert.equal(claude.args[1],prompt);assert.ok(claude.args.includes('acceptEdits'));assert.ok(!claude.args.includes('--dangerously-skip-permissions'));assert.deepEqual(claude.args.slice(-2),['--resume','session']);assert.ok(claude.args.some(a=>a.includes('Bash(node tools/compare.js *)')));
  const codex=command('codex',prompt,'thread');assert.ok(codex.args.includes('sandbox_mode="workspace-write"'));assert.equal(codex.args[codex.args.indexOf('resume')+1],'thread');assert.ok(codex.args.at(-1)!.endsWith(prompt));assert.ok(codex.args.includes('forced_login_method="chatgpt"'));
  const env={PATH:'keep',ANTHROPIC_API_KEY:'secret',ANTHROPIC_AUTH_TOKEN:'secret',CLAUDE_CODE_USE_BEDROCK:'1',OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret',AWS_ACCESS_KEY_ID:'secret',CLAUDE_CODE_OAUTH_TOKEN:'subscription'};
  assert.deepEqual(subscriptionEnv(env),{PATH:'keep',CLAUDE_CODE_OAUTH_TOKEN:'subscription'});assert.equal(env.OPENAI_API_KEY,'secret');
});
test('missing CLI and project prompt configuration errors are actionable',async()=>{
  await assert.rejects(resolveCLI('claude',{PATH:path.join(root,'does-not-exist')}),/PATH/);
  const dir=await fs.mkdtemp(path.join(root,'.test-data/prompts-'));assert.equal((await prompts(dir)).length,3);await fs.mkdir(path.join(dir,'.cutline'));await fs.writeFile(path.join(dir,'.cutline/prompts.json'),'["내 편집"]');assert.deepEqual(await prompts(dir),['내 편집']);await fs.writeFile(path.join(dir,'.cutline/prompts.json'),'{}');await assert.rejects(prompts(dir),/prompts.json/);
});
test('recorded CLI JSONL survives byte chunk boundaries, emits steps, final and errors',async()=>{
  for(const backend of ['claude','codex']){
    const events:any[]=[],parser=new JsonLines(e=>events.push(e));const data=await fs.readFile(path.join(root,`src/test/fixtures/${backend}.jsonl`));
    for(let i=0;i<data.length;i+=7)parser.feed(data.subarray(i,i+7));parser.end();
    assert.ok(events.some(e=>e.kind==='session'));assert.ok(events.some(e=>e.kind==='assistant'));assert.ok(events.some(e=>e.kind==='step'&&e.text.includes('timeline.json')));
  }
  const events:any[]=[],parser=new JsonLines(e=>events.push(e));parser.feed('noise\n{"type":"turn.failed","error":{"message":"Not logged in"}}');parser.end();assert.equal(events[0].text,'Not logged in');
});
test('agent saves log before/after, commits only timeline and respects opt out/no change',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'.test-data/agent-'));await run('git',['init'],dir);await run('git',['config','user.name','test'],dir);await run('git',['config','user.email','test@example.invalid'],dir);await run('git',['config','commit.gpgsign','false'],dir);
  const before=timeline();await writeTimeline(dir,before);await run('git',['add','timeline.json'],dir);await run('git',['commit','-m','initial'],dir);
  await fs.writeFile(path.join(dir,'unrelated.txt'),'staged');await run('git',['add','unrelated.txt'],dir);
  const after=manualEdit(before,{action:'delete',id:'b'});await writeTimeline(dir,after);assert.equal(await recordAgentEdit(dir,'첫 줄\n두 번째',before,after,true),true);assert.equal((await versions(dir))[0].message,'agent: 첫 줄');assert.match(await run('git',['diff','--cached','--name-only'],dir),/unrelated.txt/);
  assert.equal(await recordAgentEdit(dir,'no change',after,after,true),false);
  await writeTimeline(dir,before);await recordAgentEdit(dir,'opt out',after,before,false);assert.equal((await versions(dir)).length,2);
  const lines=(await fs.readFile(path.join(dir,'.cutline/edit-log.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(lines.length,2);assert.equal(lines[0].who,'agent');assert.deepEqual(lines[0].clipIds,['b']);assert.deepEqual(lines[0].before,before);assert.deepEqual(lines[0].after,after);
});
test('split/delete/trim/undo/redo validate bounds, log human edits and reject stale undo',async()=>{
  const dir=await fs.mkdtemp(path.join(root,'.test-data/manual-'));const initial=timeline();await writeTimeline(dir,initial);const session=new EditSession(),check=async(t:Timeline)=>{if(t.clips.some(c=>c.out>20))throw Error('source bounds');};
  await session.apply(dir,{action:'split',id:'a',at:4.25},check);const split=await readTimeline(dir);assert.equal(split.clips.length,3);assert.equal(split.clips[0].out,4.25);assert.equal(split.clips[1].in,4.25);assert.notEqual(split.clips[1].id,'a');
  await session.apply(dir,{action:'undo'},check);assert.deepEqual(await readTimeline(dir),initial);await session.apply(dir,{action:'redo'},check);assert.deepEqual(await readTimeline(dir),split);
  await session.apply(dir,{action:'trim',id:'a',in:1,out:3},check);await session.apply(dir,{action:'delete',id:'b'},check);assert.equal((await readTimeline(dir)).clips.length,2);
  await assert.rejects(session.apply(dir,{action:'trim',id:'a',in:1,out:21},check),/bounds/);assert.throws(()=>manualEdit(initial,{action:'split',id:'a',at:10}));assert.throws(()=>manualEdit(initial,{action:'trim',id:'a',in:3,out:2}));
  const log=(await fs.readFile(path.join(dir,'.cutline/edit-log.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.deepEqual(log.map((e:any)=>e.action),['split','undo','redo','trim','delete']);assert.ok(log.every((e:any)=>e.who==='human'&&e.before&&e.after&&e.clipIds.length));
  await writeTimeline(dir,initial);await assert.rejects(session.apply(dir,{action:'undo'},check),/외부 편집/);assert.equal(session.state.undo,false);
});
