import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {run} from '../media';
import {writeTimeline} from '../core';
import {computeSignal} from '../signals';
async function main(){
  const root=path.resolve(__dirname,'../..','sample-project');
  await fs.mkdir(path.join(root,'sources'),{recursive:true});await fs.mkdir(path.join(root,'transcripts'),{recursive:true});
  for(let i=1;i<=2;i++){
    const name=`camera-${i}.mp4`,file=path.join(root,'sources',name);
    try {await fs.access(file);}catch{
      console.log(`Generating ${name} (120 seconds)`);
      await run('ffmpeg',['-nostdin','-v','error','-y','-f','lavfi','-i',`testsrc2=size=640x360:rate=24${i===2?',hue=h=100':''}`,'-f','lavfi','-i',`sine=frequency=${i===1?440:660}:sample_rate=48000`,'-t','120','-vf',`drawtext=fontfile='C\\:/Windows/Fonts/consola.ttf':text='CAM ${i}  %{pts\\:hms}':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.7:x=20:y=20`,'-c:v','libx264','-preset','veryfast','-crf','27','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart',file]);
    }
    const topics=['소개와 오늘의 질문','문제: 영상 편집의 반복 작업','핵심 아이디어: 에이전트가 타임라인을 편집','데모: 중요한 발언을 검색','핵심 성과: 영상 패널이 즉시 반응','마무리와 다음 단계'];
    await fs.writeFile(path.join(root,'transcripts',name+'.json'),JSON.stringify(topics.map((text,j)=>({start:j*20,end:(j+1)*20,text:`[가상 대본 / 카메라 ${i}] ${text}`})),null,2)+'\n');
  }
  await writeTimeline(root,{version:1,clips:[{id:'intro',source:'sources/camera-1.mp4',in:0,out:60,reason:'원본 소개와 문제 정의'},{id:'idea',source:'sources/camera-1.mp4',in:60,out:120,reason:'아이디어 설명과 마무리'},{id:'demo',source:'sources/camera-2.mp4',in:0,out:60,reason:'두 번째 카메라의 데모 도입'},{id:'result',source:'sources/camera-2.mp4',in:60,out:120,reason:'성과와 다음 단계'}]});
  for(let i=1;i<=2;i++)await computeSignal(root,`sources/camera-${i}.mp4`);
  await fs.mkdir(path.join(root,'reference'),{recursive:true});
  await fs.writeFile(path.join(root,'reference','sample-human.timeline.json'),JSON.stringify({version:1,clips:[{id:'example-1',source:'sources/camera-1.mp4',in:20,out:80,reason:'합성 UI 시연용 사람 트랙'},{id:'example-2',source:'sources/camera-2.mp4',in:40,out:100,reason:'합성 UI 시연용 사람 트랙'}]},null,2)+'\n');
  console.log(root);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
