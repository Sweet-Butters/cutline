/* Browser-only player. No network requests: all media is a VS Code local resource. */
const vscode=acquireVsCodeApi();
const $=id=>document.getElementById(id), video=$('video');
let timeline={clips:[]}, proxies={}, transcripts={}, index=0, playing=false, revision=0, seeking=false;
let mediaGeneration=0;
const total=()=>timeline.clips.reduce((n,c)=>n+c.out-c.in,0);
const offset=i=>timeline.clips.slice(0,i).reduce((n,c)=>n+c.out-c.in,0);
const fmt=n=>{n=Math.max(0,n||0);return `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;};
const post=(type,data={})=>vscode.postMessage({type,...data});
function layoutReport(){post('layout',{width:innerWidth,height:innerHeight,videoHeight:video.getBoundingClientRect().height,timelineBottom:$('timeline').getBoundingClientRect().bottom,referencesBottom:$('references').hidden?null:$('references').getBoundingClientRect().bottom,chatVisible:$('chat').getBoundingClientRect().width>0});}
window.addEventListener('resize',layoutReport);
let chatBusy=false,chatStarted=0;
let historyPreview=false,editBusy=false,canUndo=false,canRedo=false;
function editButtons(){for(const id of ['split','delete'])$(id).disabled=chatBusy||editBusy||historyPreview||!timeline.clips.length;$('undo').disabled=chatBusy||editBusy||historyPreview||!canUndo;$('redo').disabled=chatBusy||editBusy||historyPreview||!canRedo;}
function manual(action,data={}){if(chatBusy||editBusy||historyPreview)return;playing=false;video.pause();editBusy=true;editButtons();post('manual',{action,revision,id:timeline.clips[index]?.id,at:video.currentTime,...data});}
for(const action of ['split','delete','undo','redo'])$(action).onclick=()=>manual(action);
document.addEventListener('keydown',e=>{if(e.target.closest('textarea,input,select')||e.isComposing)return;let action;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z')action=e.shiftKey?'redo':'undo';else if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='s')action='split';else if(e.key==='Delete')action='delete';if(action){e.preventDefault();if(!$(action).disabled)manual(action);}});
function chatMessage(kind,text){const el=document.createElement('div');el.className='message '+kind;el.textContent=text;$('messages').append(el);while($('messages').children.length>300)$('messages').firstChild.remove();$('messages').scrollTop=$('messages').scrollHeight;}
function busy(value){chatBusy=value;for(const id of ['send','backend','new-chat'])$(id).disabled=value;$('stop').disabled=!value;editButtons();}
$('chat-form').onsubmit=e=>{e.preventDefault();const prompt=$('prompt').value.trim();if(!prompt||chatBusy)return;post('agentSend',{prompt,backend:$('backend').value});$('prompt').value='';};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chat-form').requestSubmit();}};
$('stop').onclick=()=>{post('agentStop');$('stop').disabled=true;};
$('backend').onchange=()=>post('agentBackend',{backend:$('backend').value});
$('new-chat').onclick=()=>post('agentNew');
setInterval(()=>{if(chatBusy)$('elapsed').textContent=`편집 중 · ${Math.floor((Date.now()-chatStarted)/1000)}초`;},500);
function banner(text){$('banner').textContent=text;$('banner').classList.remove('flash');void $('banner').offsetWidth;$('banner').classList.add('flash');}
function diffText(d){return `Timeline changed: +${d.added.length} / −${d.removed.length} clips · ${d.trimmed.length} trimmed · ${d.moved.length} moved · ${fmt(d.before)} → ${fmt(d.after)}`;}
let selectedReference='';
function renderReferences(items){
  const host=$('references');host.hidden=!items.length;host.replaceChildren();
  const chosen=items.find(i=>i.name===selectedReference)||items[0];
  if(items.length>1){const select=document.createElement('select');select.setAttribute('aria-label','Human reference timeline');for(const item of items){const option=document.createElement('option');option.value=item.name;option.textContent=item.name;select.append(option);}select.value=chosen.name;select.onchange=()=>{selectedReference=select.value;renderReferences(items);};host.append(select);}
  for(const item of chosen?[chosen]:[]){
    const title=document.createElement('div');title.className='section-title';title.textContent=`HUMAN vs AI · ORIGINAL SOURCE TIME · ${item.name}`;host.append(title);
    const m=item.metrics,metrics=document.createElement('div');metrics.className='metrics';
    metrics.textContent=`Precision ${(m.precision*100).toFixed(1)}% · Recall ${(m.recall*100).toFixed(1)}% · F1 ${(m.f1*100).toFixed(1)}%`;
    const durations=document.createElement('p');durations.className='durations';durations.textContent=`AI ${fmt(m.aiDuration)} · Human ${fmt(m.humanDuration)} · Overlap ${fmt(m.overlap)} | Unique kept: AI ${fmt(m.aiKept)}, Human ${fmt(m.humanKept)}`;host.append(metrics,durations);
    const groups=document.createElement('div');groups.className='reference-sources';host.append(groups);
    for(const source of item.sources){
      const group=document.createElement('div');group.className='source-group';groups.append(group);
      const label=document.createElement('div');label.className='source-label';label.textContent=source.source;group.append(label);
      for(const [key,name] of [['ai','AI edit'],['human','Human edit']]){
        const row=document.createElement('div');row.className='reference-row';const label=document.createElement('b');label.textContent=name;
        const strip=document.createElement('div');strip.className=`source-strip ${key}`;strip.setAttribute('aria-label',name+' on original source time');
        for(const c of source[key]){const bar=document.createElement('span');bar.className='kept';bar.style.left=`${c.in/source.duration*100}%`;bar.style.width=`${(c.out-c.in)/source.duration*100}%`;bar.title=`${name}: ${fmt(c.in)} – ${fmt(c.out)}`;strip.append(bar);}
        row.append(label,strip);group.append(row);
      }
      const axis=document.createElement('div');axis.className='source-axis';for(let i=0;i<=4;i++){const tick=document.createElement('span');tick.textContent=fmt(source.duration*i/4);axis.append(tick);}group.append(axis);
    }
  }
  post('referencesApplied',{items:items.map(i=>({name:i.name,metrics:i.metrics})),bars:host.querySelectorAll('.kept').length});
}
function renderStrip(d){
  $('timeline').replaceChildren();$('ghosts').replaceChildren();
  timeline.clips.forEach((c,i)=>{
    const b=document.createElement('button');b.className='block';b.style.flexGrow=String(c.out-c.in);
    if(d?.added.some(x=>x.id===c.id))b.classList.add('added');
    if(d?.trimmed.some(x=>x.id===c.id))b.classList.add('trimmed');
    if(d?.moved.includes(c.id))b.classList.add('moved');
    b.textContent=c.id;const small=document.createElement('small');small.textContent=fmt(c.out-c.in);b.append(small);
    b.title=`${c.source} [${c.in}–${c.out}]\n${c.reason||''}`;b.onclick=()=>select(i);$('timeline').append(b);
    for(const edge of ['in','out']){
      const handle=document.createElement('span');handle.className='trim-handle '+edge;handle.title=edge==='in'?'시작 트림':'끝 트림';b.append(handle);
      handle.onclick=e=>e.stopPropagation();
      handle.onpointerdown=e=>{
        if(chatBusy||editBusy||historyPreview)return;e.preventDefault();e.stopPropagation();playing=false;video.pause();select(i);
        const start=e.clientX,secondsPerPixel=(c.out-c.in)/b.getBoundingClientRect().width;let value=c[edge];handle.setPointerCapture(e.pointerId);
        handle.onpointermove=move=>{value=Math.round((c[edge]+(move.clientX-start)*secondsPerPixel)*100)/100;value=edge==='in'?Math.max(0,Math.min(c.out-.04,value)):Math.max(c.in+.04,value);small.textContent=`${value.toFixed(2)}s`;};
        const finish=()=>{handle.onpointermove=null;handle.onpointerup=null;handle.onpointercancel=null;};
        handle.onpointerup=()=>{finish();if(value!==c[edge])manual('trim',{id:c.id,in:edge==='in'?value:c.in,out:edge==='out'?value:c.out});else small.textContent=fmt(c.out-c.in);};
        handle.onpointercancel=()=>{finish();small.textContent=fmt(c.out-c.in);};
      };
    }
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
  if(video.getAttribute('src')!==proxies[c.source]){video.onloadedmetadata=()=>{post('playback',{event:'loadedmetadata',revision,source:c.source,duration:video.duration,width:video.videoWidth,height:video.videoHeight});seek();};video.src=proxies[c.source];video.load();}else seek();
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
video.onerror=()=>{playing=false;$('error').hidden=false;$('error').textContent=`Playback failed (${video.error?.code}): ${video.error?.message}`;post('playback',{event:'error',revision,message:video.error?.message});};
video.onended=()=>{if(playing&&!seeking)advance();};
function frame(){const c=timeline.clips[index];if(playing&&!seeking&&c&&video.currentTime>=c.out-0.025)advance();update();requestAnimationFrame(frame);}requestAnimationFrame(frame);
$('play').onclick=()=>{if(!timeline.clips.length)return;playing=!playing;if(playing){const c=timeline.clips[index];if(video.currentTime>=c.out-.025)select(0);else video.play().catch(e=>{playing=false;banner(e.message);});}else video.pause();update();};
$('previous').onclick=()=>select(Math.max(0,index-1));$('next').onclick=()=>select(Math.min(timeline.clips.length-1,index+1));
$('scrub').oninput=()=>{let n=Number($('scrub').value);for(let i=0;i<timeline.clips.length;i++){const c=timeline.clips[i],d=c.out-c.in;if(n<d||i===timeline.clips.length-1){select(i,c.in+n);break;}n-=d;}};
for(const type of ['current','compare','restore','export'])$(type).onclick=()=>post(type);$('refresh').onclick=()=>post('versions');
window.addEventListener('message',async({data:m})=>{
  if(m.type==='focusChat')$('prompt').focus();
  if(m.type==='chatInit'){$('backend').value=m.backend;for(const text of m.prompts||[]){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>{$('prompt').value=text;$('prompt').focus();};$('chips').append(b);}post('chatReady');}
  if(m.type==='chatEvent'){
    if(m.kind==='start'){busy(true);chatStarted=m.started;chatMessage('user',m.text);}
    else if(m.kind==='done'){busy(false);$('elapsed').textContent=`완료 · ${(m.elapsedMs/1000).toFixed(1)}초`;}
    else chatMessage(m.kind,m.text);
  }
  if(m.type==='editState'){canUndo=m.undo;canRedo=m.redo;editBusy=false;editButtons();}
  if(m.type==='clearError')$('error').hidden=true;
  if(m.type==='references')renderReferences(m.items);
  if(m.type==='timeline'){
    const old=timeline.clips[index],oldTime=video.currentTime;
    timeline=m.timeline;proxies=m.proxies;transcripts=m.transcripts;revision=m.revision;
    historyPreview=!!m.version;editButtons();
    $('error').hidden=true;$('empty').hidden=!!timeline.clips.length;$('restore').disabled=!m.version;
    $('version-label').textContent=m.version?`Preview: ${m.version.slice(0,8)}`:'Current working file';
    renderStrip(m.diff);
    banner(m.diff?diffText(m.diff):`${timeline.clips.length} clips · ${fmt(total())} · ${m.version?'Version preview':'Live · watching timeline.json'}`);
    const keep=timeline.clips.findIndex(c=>c.id===old?.id);
    if(timeline.clips.length)select(keep>=0?keep:0,keep>=0?oldTime:undefined);
    else{playing=false;++mediaGeneration;video.pause();video.removeAttribute('src');video.load();$('transcript').replaceChildren();$('clip').textContent='';$('reason').textContent='';}
    post('applied',{revision,diff:m.diff,format:m.format,clipCount:timeline.clips.length,banner:$('banner').textContent,blocks:$('timeline').children.length,ghosts:$('ghosts').children.length});
    layoutReport();
  }
  if(m.type==='status')$('banner').textContent=m.message;
  if(m.type==='error'){editBusy=false;editButtons();$('error').hidden=false;$('error').textContent=m.message;}
  if(m.type==='comparison'){banner('Preview → current · '+diffText(m.diff));$('ghosts').replaceChildren();for(const [label,clips] of [['Added',m.diff.added],['Removed',m.diff.removed],['Trimmed',m.diff.trimmed]]){const p=document.createElement('p');p.textContent=`${label}: ${clips.map(c=>c.id).join(', ')||'—'}`;$('ghosts').append(p);}post('comparisonApplied',{diff:m.diff});}
  if(m.type==='versions'){
    $('versions').replaceChildren();if(m.warning)$('versions').textContent=m.warning;
    for(const v of m.items){const b=document.createElement('button');b.className='version';b.textContent=v.message;const sub=document.createElement('small');sub.textContent=`${v.hash.slice(0,8)} · ${v.date}`;b.append(sub);b.onclick=()=>post('preview',{hash:v.hash});$('versions').append(b);}
  }
  if(m.type==='codecProbe'){
    const probe=document.createElement('video');probe.muted=true;let done=false;
    const finish=result=>{if(done)return;done=true;post('codecResult',{...result,url:m.url,width:probe.videoWidth,height:probe.videoHeight,canPlayType:probe.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),webmType:probe.canPlayType('video/webm; codecs="vp8, vorbis"'),mp3Type:probe.canPlayType('audio/mpeg')});probe.removeAttribute('src');probe.load();};
    probe.oncanplay=()=>finish({decoded:true});probe.onerror=()=>finish({decoded:false,code:probe.error?.code,message:probe.error?.message});probe.src=m.url;probe.load();setTimeout(()=>finish({decoded:false,timeout:true}),15000);
  }
  if(m.type==='testAction'){
    if(m.action==='chat'){$('backend').value=m.backend;$('prompt').value=m.prompt;$('chat-form').requestSubmit();}
    if(m.action==='resetChat'){$('backend').value=m.backend;$('backend').onchange();$('new-chat').click();}
    if(m.action==='manual')manual(m.edit,m.data||{});
    if(m.action==='play'){if(m.muted)video.muted=true;$('play').click();}
    if(m.action==='select')select(m.index,m.time);
    if(m.action==='click')$(m.id).click();
    if(m.action==='transcript')$('transcript').children[m.index]?.click();
    if(m.action==='version')$('versions').children[m.index]?.click();
    if(m.action==='snapshot')post('snapshot',{tag:m.tag,index,time:video.currentTime,paused:video.paused,playing,seeking,banner:$('banner').textContent,width:video.videoWidth,frames:video.getVideoPlaybackQuality().totalVideoFrames,audioBytes:video.webkitAudioDecodedByteCount,version:$('version-label').textContent,transcript:$('transcript').textContent,versionCount:$('versions').children.length,error:$('error').hidden?null:$('error').textContent});
  }
});post('ready');
