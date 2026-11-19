/* Browser-only player. No network requests: all media is a VS Code local resource. */
const vscode=acquireVsCodeApi();
const $=id=>document.getElementById(id), video=$('video');
let timeline={clips:[]}, proxies={}, transcripts={}, index=0, playing=false, revision=0, seeking=false;
let mediaGeneration=0;
const total=()=>timeline.clips.reduce((n,c)=>n+c.out-c.in,0);
const offset=i=>timeline.clips.slice(0,i).reduce((n,c)=>n+c.out-c.in,0);
const fmt=n=>{n=Math.max(0,n||0);return `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;};
const post=(type,data={})=>vscode.postMessage({type,...data});
function banner(text){$('banner').textContent=text;$('banner').classList.remove('flash');void $('banner').offsetWidth;$('banner').classList.add('flash');}
function diffText(d){return `Timeline changed: +${d.added.length} / −${d.removed.length} clips · ${d.trimmed.length} trimmed · ${d.moved.length} moved · ${fmt(d.before)} → ${fmt(d.after)}`;}
function renderStrip(d){
  $('timeline').replaceChildren();$('ghosts').replaceChildren();
  timeline.clips.forEach((c,i)=>{
    const b=document.createElement('button');b.className='block';b.style.flexGrow=String(c.out-c.in);
    if(d?.added.some(x=>x.id===c.id))b.classList.add('added');
    if(d?.trimmed.some(x=>x.id===c.id))b.classList.add('trimmed');
    if(d?.moved.includes(c.id))b.classList.add('moved');
    b.textContent=c.id;const small=document.createElement('small');small.textContent=fmt(c.out-c.in);b.append(small);
    b.title=`${c.source} [${c.in}–${c.out}]\n${c.reason||''}`;b.onclick=()=>select(i);$('timeline').append(b);
  });
  for(const c of d?.removed||[]){const ghost=document.createElement('span');ghost.className='ghost';ghost.textContent=`− ${c.id} (${fmt(c.out-c.in)})`;ghost.title=c.reason||'';$('ghosts').append(ghost);}
}
function renderTranscript(){
  $('transcript').replaceChildren();const c=timeline.clips[index];if(!c)return;
  const lines=(transcripts[c.source]||[]).filter(s=>s.end>c.in&&s.start<c.out);
  if(!lines.length)$('transcript').textContent='No transcript for this clip.';
  for(const s of lines){const b=document.createElement('button');b.className='line';b.dataset.start=s.start;b.dataset.end=s.end;const stamp=document.createElement('span');stamp.textContent=fmt(s.start);b.append(stamp,document.createTextNode(s.text));b.onclick=()=>select(index,Math.max(c.in,s.start));$('transcript').append(b);}
}
function select(i,at){
  const c=timeline.clips[i];if(!c)return;
  index=i;const generation=++mediaGeneration;seeking=true;
  const target=Math.max(c.in,Math.min(at??c.in,c.out-0.001));
  video.pause();video.onloadedmetadata=null;video.onseeked=null;
  const seek=()=>{
    if(generation!==mediaGeneration)return;
    video.onseeked=()=>{if(generation!==mediaGeneration)return;seeking=false;update();if(playing)video.play().catch(e=>{playing=false;banner(`Press Play: ${e.message}`);});};
    video.currentTime=target;
    // Assigning zero at startup may not emit seeked in Chromium.
    if(target===0&&video.currentTime===0){seeking=false;if(playing)video.play().catch(()=>{});}
    update();
  };
  if(video.getAttribute('src')!==proxies[c.source]){video.onloadedmetadata=()=>{post('playback',{event:'loadedmetadata',revision,source:c.source,duration:video.duration});seek();};video.src=proxies[c.source];video.load();}else seek();
  $('clip').textContent=`${i+1} / ${timeline.clips.length} · ${c.id}`;$('reason').textContent=c.reason||'';
  [...$('timeline').children].forEach((b,j)=>b.classList.toggle('active',j===index));renderTranscript();
}
function update(){
  const c=timeline.clips[index];const position=c?offset(index)+Math.max(0,Math.min(video.currentTime-c.in,c.out-c.in)):0;
  $('time').textContent=`${fmt(position)} / ${fmt(total())}`;$('scrub').max=String(total()||1);$('scrub').value=String(position);
  $('play').textContent=playing?'❚❚ Pause':'▶ Play';
  for(const b of $('transcript').children)b.classList.toggle('active',video.currentTime>=Number(b.dataset.start)&&video.currentTime<Number(b.dataset.end));
}
function advance(){if(index+1<timeline.clips.length)select(index+1);else{playing=false;video.pause();update();}}
video.oncanplay=()=>post('playback',{event:'canplay',revision,source:timeline.clips[index]?.source});
video.onerror=()=>{playing=false;$('error').hidden=false;$('error').textContent=`Playback failed (${video.error?.code}): ${video.error?.message}`;post('playback',{event:'error',message:video.error?.message});};
video.onended=()=>{if(playing&&!seeking)advance();};
function frame(){const c=timeline.clips[index];if(playing&&!seeking&&c&&video.currentTime>=c.out-0.025)advance();update();requestAnimationFrame(frame);}requestAnimationFrame(frame);
$('play').onclick=()=>{if(!timeline.clips.length)return;playing=!playing;if(playing){const c=timeline.clips[index];if(video.currentTime>=c.out-.025)select(0);else video.play().catch(e=>{playing=false;banner(e.message);});}else video.pause();update();};
$('previous').onclick=()=>select(Math.max(0,index-1));$('next').onclick=()=>select(Math.min(timeline.clips.length-1,index+1));
$('scrub').oninput=()=>{let n=Number($('scrub').value);for(let i=0;i<timeline.clips.length;i++){const c=timeline.clips[i],d=c.out-c.in;if(n<d||i===timeline.clips.length-1){select(i,c.in+n);break;}n-=d;}};
for(const type of ['current','compare','restore','export'])$(type).onclick=()=>post(type);$('refresh').onclick=()=>post('versions');
window.addEventListener('message',async({data:m})=>{
  if(m.type==='timeline'){
    const old=timeline.clips[index],oldTime=video.currentTime;
    timeline=m.timeline;proxies=m.proxies;transcripts=m.transcripts;revision=m.revision;
    $('error').hidden=true;$('empty').hidden=!!timeline.clips.length;$('restore').disabled=!m.version;
    $('version-label').textContent=m.version?`Preview: ${m.version.slice(0,8)}`:'Current working file';
    renderStrip(m.diff);
    banner(m.diff?diffText(m.diff):`${timeline.clips.length} clips · ${fmt(total())} · ${m.version?'Version preview':'Live · watching timeline.json'}`);
    const keep=timeline.clips.findIndex(c=>c.id===old?.id);
    if(timeline.clips.length)select(keep>=0?keep:0,keep>=0?oldTime:undefined);
    else{playing=false;++mediaGeneration;video.pause();video.removeAttribute('src');video.load();$('transcript').replaceChildren();$('clip').textContent='';$('reason').textContent='';}
    post('applied',{revision,diff:m.diff,clipCount:timeline.clips.length,banner:$('banner').textContent,blocks:$('timeline').children.length,ghosts:$('ghosts').children.length});
  }
  if(m.type==='status')$('banner').textContent=m.message;
  if(m.type==='error'){$('error').hidden=false;$('error').textContent=m.message;}
  if(m.type==='comparison'){banner('Preview → current · '+diffText(m.diff));$('ghosts').replaceChildren();for(const [label,clips] of [['Added',m.diff.added],['Removed',m.diff.removed],['Trimmed',m.diff.trimmed]]){const p=document.createElement('p');p.textContent=`${label}: ${clips.map(c=>c.id).join(', ')||'—'}`;$('ghosts').append(p);}}
  if(m.type==='versions'){
    $('versions').replaceChildren();if(m.warning)$('versions').textContent=m.warning;
    for(const v of m.items){const b=document.createElement('button');b.className='version';b.textContent=v.message;const sub=document.createElement('small');sub.textContent=`${v.hash.slice(0,8)} · ${v.date}`;b.append(sub);b.onclick=()=>post('preview',{hash:v.hash});$('versions').append(b);}
  }
  if(m.type==='codecProbe'){
    const probe=document.createElement('video');probe.muted=true;let done=false;
    const finish=result=>{if(done)return;done=true;post('codecResult',{...result,canPlayType:probe.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')});probe.removeAttribute('src');probe.load();};
    probe.oncanplay=()=>finish({decoded:true});probe.onerror=()=>finish({decoded:false,code:probe.error?.code,message:probe.error?.message});probe.src=m.url;probe.load();setTimeout(()=>finish({decoded:false,timeout:true}),15000);
  }
});post('ready');
