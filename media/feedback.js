/* Local review threads. No account, network synchronization or simulated presence. */
(function () {
  'use strict';
  const labels = ['수정 요청', '편집 중', '수정 완료', '편집 완료', '보류', '검토 완료'];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, title, fn, cls = '') => { const n = el('button', cls, text); n.type = 'button'; n.title = title || text; n.onclick = fn; return n; };
  const stamp = seconds => { const ms = Math.max(0, Math.round((seconds || 0) * 1000)), s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':') + '.' + String(ms % 1000).padStart(3, '0'); };
  const short = seconds => stamp(seconds).replace(/\.000$/, '');
  function seconds(value, fps = 30) { const input = String(value).trim(); if (/^\d+(?:\.\d+)?$/.test(input)) return Number(input); const fields = input.split(':'); if (fields.length === 4 && fields.every(x => /^\d+$/.test(x)) && Number(fields[1]) < 60 && Number(fields[2]) < 60 && Number(fields[3]) < fps) return Number(fields[0]) * 3600 + Number(fields[1]) * 60 + Number(fields[2]) + Number(fields[3]) / fps; if ((fields.length === 2 || fields.length === 3) && fields.every(x => /^\d+(?:\.\d+)?$/.test(x)) && fields.slice(1).every(x => Number(x) < 60)) return fields.reduce((s, n) => s * 60 + Number(n), 0); throw Error('시간은 초 또는 00:01:20.000 형식으로 입력하세요.'); }
  const date = value => { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)); } catch { return ''; } };
  const versionLabel = version => Number.isSafeInteger(version?.number)&&version.number>0?'v'+version.number:'버전 확인 중';

  class FeedbackPanel {
    constructor(options) {
      this.options = options; this.host = options.host; this.saved = options.saved || {}; this.opened = this.saved.open ?? innerWidth >= 1180; this.draft = this.saved.draft || { body: '', mode: 'point', status: labels[0], start: '', end: '', clipId: '', versionId: null,pinned:false }; this.replyDrafts = this.saved.replyDrafts || {};this.relinkDrafts=this.saved.relinkDrafts||{}; this.pending = new Map(); this.replyOpen = new Map(); this.limit = 20;
      this.build(); this.setOpen(this.opened); this.host.addEventListener('keydown', e => { e.stopPropagation(); if(this.dialog?.open){if(e.key==='Escape'){e.preventDefault();this.closeDialog();}return;}if (e.key === 'Escape') { const open=[...this.host.querySelectorAll('details[open]')];if(open.length){open.forEach(n=>n.open=false);}else{this.setOpen(false);document.getElementById('toggle-feedback')?.focus();} } });
      this.host.addEventListener('click',e=>{for(const menu of this.host.querySelectorAll('.fb-settings[open],.fb-time-options[open]'))if(!menu.contains(e.target))menu.open=false;});
      const timer=setInterval(()=>{if(this.opened&&this.state&&!this.draft.pinned&&!this.textarea.value&&!this.form.contains(document.activeElement)){const c=this.options.context();if(c.versionId===this.state.viewVersion.id){this.draft.start=this.start.value=stamp(c.time);this.draft.clipId=c.activeClipId||'';this.updateTargets();this.updateComposer();}}},250);window.addEventListener('pagehide',()=>clearInterval(timer));
    }
    build() {
      this.host.innerHTML = `<div class="fb-header"><span class="fb-comment-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg></span><strong>댓글</strong><span class="fb-count">0</span><details class="fb-settings"><summary class="fb-settings-toggle" aria-label="댓글 설정" title="작성자 설정 · 저장 정보">•••</summary><div class="fb-settings-menu"><strong>작성자 설정</strong><form class="fb-profile-form"><label>이름<input name="name" maxlength="60" required aria-label="피드백 작성자 이름"></label><label>역할<select name="role" aria-label="피드백 작성자 역할"><option>편집자</option><option>편집 제안자</option></select></label><button type="submit">저장</button></form><p class="fb-local">이 컴퓨터에 저장 · 원격 동기화 없음</p><p class="fb-profile-note">이름·역할은 계정 인증이 없는 로컬 표시 정보입니다.</p></div></details></div><div class="fb-toolbar"><select class="fb-sort" aria-label="댓글 정렬"><option value="newest">최신순</option><option value="oldest">오래된순</option><option value="time">영상 시간순</option></select><span class="fb-current-version" aria-label="현재 보는 편집 버전"></span></div><div class="fb-view" hidden><span class="fb-view-label"></span><span class="fb-view-code"></span></div><div class="fb-body"><div class="fb-list" aria-label="피드백 스레드"></div></div><div class="fb-status-message" role="status" aria-live="polite" hidden></div><form class="fb-composer"><div class="fb-compose-row"><span class="fb-avatar fb-self-avatar" aria-hidden="true">나</span><textarea name="body" maxlength="5000" placeholder="댓글을 남겨 보세요…" aria-label="새 편집 피드백" required rows="2"></textarea></div><div class="fb-compose-footer"><details class="fb-time-options"><summary class="fb-compose-time" title="댓글을 남길 시점이나 구간 설정" aria-label="댓글 시간 설정">00:00:00</summary><div class="fb-location-editor"><strong>댓글 시간</strong><div class="fb-anchor-toolbar"><button type="button" data-capture="point">현재 시점</button><button type="button" data-capture="range">선택 구간</button><button type="button" data-mode="range">구간 지정</button></div><div class="fb-time-fields"><label>시작<input name="start" placeholder="00:01:20.000" aria-label="피드백 시작 시각" required></label><span class="fb-range-only" hidden>–</span><label class="fb-range-only" hidden>종료<input name="end" placeholder="00:01:23.000" aria-label="피드백 종료 시각"></label></div><select name="clipId" class="fb-target" aria-label="피드백 대상 클립"></select><label>상태<select name="status" aria-label="새 피드백 상태"></select></label></div></details><span class="fb-counter" hidden>0 / 5000</span><button type="submit">게시 ↑</button></div><p class="fb-anchor-version" hidden></p></form>`;
      this.host.querySelector('.fb-header').append(btn('×', '피드백 패널 닫기', () => this.setOpen(false)));
      this.dialog=el('dialog','fb-dialog');this.dialog.setAttribute('aria-labelledby','fb-dialog-title');const heading=el('div','fb-dialog-heading');this.dialogTitle=el('strong','','');this.dialogTitle.id='fb-dialog-title';heading.append(this.dialogTitle,btn('×','닫기',()=>this.closeDialog(),'fb-dialog-close'));this.dialogError=el('p','fb-dialog-error');this.dialogError.hidden=true;this.dialogError.setAttribute('role','alert');this.dialogContent=el('div','fb-dialog-content');this.dialog.append(heading,this.dialogError,this.dialogContent);this.dialog.oncancel=e=>{e.preventDefault();this.closeDialog();};this.host.append(this.dialog);
      this.form = this.host.querySelector('.fb-composer'); this.textarea = this.form.elements.body; this.start = this.form.elements.start; this.end = this.form.elements.end; this.target = this.form.elements.clipId; this.message = this.host.querySelector('.fb-status-message'); this.list = this.host.querySelector('.fb-list');
      for (const status of labels) this.form.elements.status.append(el('option', '', status)); this.form.elements.status.value = this.draft.status;
      this.textarea.value = this.draft.body; this.start.value = this.draft.start; this.end.value = this.draft.end;
      this.textarea.onfocus = () => { if (!this.draft.versionId||!this.draft.pinned) this.capture('point'); };
      this.textarea.oninput = () => { this.draft.body = this.textarea.value; this.updateComposer(); this.save(); };
      for (const field of [this.start, this.end]) field.oninput = () => { this.draft[field.name] = field.value;this.draft.pinned=true; this.updateComposer(); this.save(); };
      this.target.onchange = () => { this.draft.clipId = this.target.value;this.draft.pinned=true; this.save(); };
      this.form.elements.status.onchange = () => { this.draft.status = this.form.elements.status.value; this.save(); };
      for (const b of this.host.querySelectorAll('[data-capture]')) b.onclick = () => this.capture(b.dataset.capture);
      this.host.querySelector('[data-mode]').onclick = () => { try { if (!this.draft.versionId) this.capture('point'); const next = this.draft.mode === 'range' ? 'point' : 'range'; if (next === 'range' && !this.end.value) this.end.value = this.draft.end = stamp(Math.min(this.options.context().duration, seconds(this.start.value, this.options.context().fps) + 3)); this.draft.mode = next; this.draft.pinned = true; this.updateComposer(); this.save(); } catch (error) { this.notice(error.message, true); } };
      this.form.onsubmit = e => { e.preventDefault(); try { const location = this.location(),body=this.textarea.value; this.request('create', { body, status: this.form.elements.status.value, ...location }, () => { if(this.textarea.value===body){this.draft.body = ''; this.textarea.value = ''; this.draft.versionId = null; this.capture('point',false);}this.host.querySelector('.fb-time-options').open=false; this.save(); this.notice('댓글을 저장했습니다.'); }); } catch (error) { this.notice(error.message, true); } };
      const profile = this.host.querySelector('.fb-profile-form'); profile.onsubmit = e => { e.preventDefault(); this.request('profile', { name: profile.elements.name.value, role: profile.elements.role.value }, () => { this.host.querySelector('.fb-settings').open = false; this.notice('작성자 설정을 저장했습니다.'); }); };
      this.host.querySelector('.fb-sort').onchange=()=>{this.limit=20;this.renderThreads();};
      this.updateComposer(); this.list.append(el('p', 'fb-loading', '로컬 피드백을 불러오는 중…'));
    }
    save() { this.options.onState?.({ open: this.opened, draft: this.draft, replyDrafts: this.replyDrafts,relinkDrafts:this.relinkDrafts }); }
    setOpen(open) { this.opened = open; document.body.classList.toggle('feedback-open', open); this.host.setAttribute('aria-hidden', String(!open)); document.getElementById('toggle-feedback')?.setAttribute('aria-expanded', String(open)); this.save(); if (open && !this.state) this.options.onLoad?.(); }
    toggle() { this.setOpen(!this.opened); }
    notice(text, error = false) { clearTimeout(this.noticeTimer);this.message.hidden = !text; this.message.textContent = text; this.message.classList.toggle('error', error);if(text&&!error)this.noticeTimer=setTimeout(()=>this.message.hidden=true,3000); }
    updateComposer() {
      for (const n of this.form.querySelectorAll('.fb-range-only')) n.hidden = this.draft.mode !== 'range';
      this.form.querySelector('[data-mode]').classList.toggle('on', this.draft.mode === 'range'); this.host.querySelector('.fb-counter').textContent = this.textarea.value.length + ' / 5000';
      const stale = this.draft.versionId && this.state && this.draft.versionId !== this.state.viewVersion.id, label = this.form.querySelector('.fb-anchor-version'); label.classList.toggle('stale', !!stale);
      label.hidden=!stale;this.form.querySelector('.fb-compose-time').textContent=short(this.safeTime(this.draft.start))+(this.draft.mode==='range'&&this.draft.end?' – '+short(this.safeTime(this.draft.end)):'')+' ⌄';
      label.textContent = stale ? '편집 버전이 바뀌었습니다. 현재 시점을 다시 지정하세요. 작성 내용은 유지됩니다.' : this.draft.versionId ? '지정된 위치 · ' + (this.state ? versionLabel(this.state.versions.find(v => v.id === this.draft.versionId)) : '버전 확인 중') : '현재 시점이나 구간을 지정하세요.';
      this.form.querySelector('[type="submit"]').disabled = !this.state || !!stale || !this.draft.versionId || !this.textarea.value.trim() || this.pending.size > 0;
    }
    safeTime(value){try{return seconds(value,this.options.context().fps);}catch{return 0;}}
    capture(mode,pinned=true) {
      const context = this.options.context(); if (!context.versionId) { this.notice('영상이 준비된 뒤 위치를 지정하세요.', true); return; }
      let start = context.time, end;
      if (mode === 'range') { if (context.selection) { start = context.selection.start; end = context.selection.end; } else end = Math.min(context.duration, start + 3); }
      this.draft = { ...this.draft,pinned, mode: mode === 'range' ? 'range' : 'point', start: stamp(start), end: end === undefined ? '' : stamp(end), versionId: context.versionId, clipId: mode === 'range' ? '' : context.activeClipId || '' };
      this.start.value = this.draft.start; this.end.value = this.draft.end; this.updateTargets(); this.updateComposer(); this.save();
    }
    updateTargets() {
      const context = this.options.context(), value = this.draft.clipId || ''; this.target.replaceChildren(); const automatic = el('option', '', '자동 대상 · 겹치는 영상은 직접 선택'); automatic.value = ''; this.target.append(automatic);
      for (const clip of context.clips || []) { const option = el('option', '', `${clip.trackId} · ${clip.name || clip.id} · ${short(clip.start)}–${short(clip.end)}`); option.value = clip.id; this.target.append(option); }
      if ([...this.target.options].some(o => o.value === value)) this.target.value = value; else if (value) { const old = el('option', '', '이전 버전의 클립 · 다시 지정 필요'); old.value = value; this.target.append(old); this.target.value = value; }
    }
    location() {
      if (!this.state || this.draft.versionId !== this.state.viewVersion.id) throw Error('현재 보는 버전에서 위치를 다시 지정하세요.');
      const fps = this.options.context().fps, start = seconds(this.start.value, fps), end = this.draft.mode === 'range' ? seconds(this.end.value, fps) : undefined;
      if (start < 0 || start >= this.state.viewVersion.duration || end !== undefined && (end <= start || end > this.state.viewVersion.duration)) throw Error('영상 안의 시점 또는 올바른 구간을 입력하세요.');
      return { versionId: this.draft.versionId, start, ...(end === undefined ? {} : { end }), ...(this.target.value ? { clipId: this.target.value } : {}) };
    }
    request(action, input, success) {
      if (!this.state || this.pending.size) return; const requestId = crypto.randomUUID(); this.pending.set(requestId, { action, success }); this.updateComposer(); this.host.querySelectorAll('.fb-status-select').forEach(n => n.disabled = true); this.notice('이 컴퓨터에 저장 중…');
      this.options.onRequest({ action: 'mutate', requestId, input: { ...input, action, requestId, expectedRevision: input.expectedRevision ?? this.state.revision } });
    }
    navigate(threadId, mode) {
      if (this.pending.size) return;this.renderThreads(); const requestId = crypto.randomUUID(); this.pending.set(requestId, { action: 'navigate' }); this.updateComposer(); this.notice('편집 버전과 원본 위치를 확인 중…'); this.options.onRequest({ action: 'navigate', requestId, threadId, mode });
    }
    receive(message) {
      if (message.type === 'feedbackState') { this.accept(message); return; }
      if (message.type === 'feedbackError') { this.notice(message.message, true); return; }
      if (message.type !== 'feedbackResult') return;
      const pending = this.pending.get(message.requestId); if (!pending) return; this.pending.delete(message.requestId);
      if (message.state) this.accept(message);
      if (message.ok) { pending.success?.(); if (!pending.success) this.notice(pending.action === 'navigate' ? '지정한 버전의 위치로 이동했습니다.' : '저장했습니다.'); }
      else{this.notice(message.message || '저장하지 못했습니다. 작성 내용은 유지됩니다.', true);if(this.dialog.open){this.dialogError.textContent=message.message||'저장하지 못했습니다. 다시 시도하세요.';this.dialogError.hidden=false;this.dialogContent.querySelectorAll('button[type=submit],.fb-delete-confirm,textarea:disabled').forEach(n=>n.disabled=false);}}
      this.updateComposer(); this.renderThreads(); this.save();
    }
    accept(message) {
      if (message.viewVersionId !== this.options.context().versionId) return;
      this.state = message.state; this.preview = message.preview; this.host.querySelector('.fb-count').textContent = this.state.threads.length;
      this.host.querySelector('.fb-current-version').textContent=(this.preview?'미리보기 ':'현재 ')+versionLabel(this.state.viewVersion);
      this.host.querySelector('.fb-view-label').textContent = this.preview ? versionLabel(this.state.viewVersion)+' · 미리보기 · 읽기 전용' : '현재 편집본'; this.host.querySelector('.fb-view-code').textContent = versionLabel(this.state.viewVersion);
      this.host.querySelector('.fb-view').hidden=!this.preview;
      let current = this.host.querySelector('.fb-view button'); if (this.preview && !current) this.host.querySelector('.fb-view').append(btn('현재 편집본', '작업 중인 편집본으로 돌아가기', () => this.options.onCurrent())); if (!this.preview && current) current.remove();
      const profile = this.host.querySelector('.fb-profile-form'); if (!profile.contains(document.activeElement)) { profile.elements.name.value = this.state.profile.name; profile.elements.role.value = this.state.profile.role; }
      const avatar=this.host.querySelector('.fb-self-avatar');avatar.textContent=[...this.state.profile.name].slice(0,2).join('');avatar.title=this.state.profile.name+' · 이름 변경은 상단 •••';
      if (!this.draft.versionId && !this.textarea.value) this.capture('point',false); else { this.updateTargets(); this.updateComposer(); }
      this.renderThreads();
    }
    renderThreads() {
      if (!this.state) return;
      const active = document.activeElement, focus = active?.dataset?.draftKey, selection = focus && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      const sort=this.host.querySelector('.fb-sort').value,anchorTime=t=>t.resolution.state==='linked'?t.resolution.start:t.anchors[0].anchor.start;
      const threads=[...this.state.threads].sort((a,b)=>sort==='time'?anchorTime(a)-anchorTime(b)||a.createdAt.localeCompare(b.createdAt):sort==='oldest'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));
      this.list.replaceChildren();
      if (!threads.length) { const empty = el('div', 'fb-empty'); empty.append(el('strong', '', '첫 댓글을 남겨 보세요.'), document.createTextNode('영상을 보다가 아래에 의견을 적어 주세요.')); this.list.append(empty); }
      for (const thread of threads.slice(0, this.limit)) this.list.append(this.renderThread(thread));
      if (threads.length > this.limit) this.list.append(btn('피드백 더 보기', '', () => { this.limit += 20; this.renderThreads(); }, 'fb-more'));
      if (focus) { const target = [...this.list.querySelectorAll('[data-draft-key]')].find(n => n.dataset.draftKey === focus); if (target) { target.focus({ preventScroll: true }); if (selection) target.setSelectionRange(...selection); } }
    }
    authorLine(author, at, compact = false) {
      const row = el('div', 'fb-author-row'), avatar = el('span', 'fb-avatar', [...author.name].slice(0,2).join('') || '?'), info = el('div', 'fb-author-info'), name = el('strong', 'fb-author-name', author.name),when=el('time','fb-date',date(at));name.title=author.role;when.dateTime=at;when.title=new Date(at).toLocaleString('ko-KR'); info.append(name,when); row.append(avatar, info); return row;
    }
    renderThread(t) {
      const card=el('article','fb-thread'+(t.resolution.state==='needs_review'?' needs-review':'')+(this.selected===t.id?' selected':''));card.dataset.thread=t.id;
      const author=this.authorLine(t.author,t.createdAt),status=el('select','fb-status-select');status.setAttribute('aria-label','댓글 상태');for(const label of labels)status.append(el('option','',label));status.value=t.status;status.disabled=this.pending.size>0;status.onchange=()=>{const next=status.value;status.value=t.status;this.request('status',{threadId:t.id,status:next});};author.append(status);if(t.editedAt){const edited=el('span','fb-edited',' · 수정됨');edited.title='마지막 수정 '+date(t.editedAt);author.querySelector('.fb-date').append(edited);}card.append(author);
      const original=t.anchors[0].anchor,resolution=t.resolution,linked=resolution.state==='linked',start=linked?resolution.start:original.start,end=linked?resolution.end:original.end;
      const time=btn(short(start)+(end===undefined?'':' – '+short(end)),linked?'이 장면으로 이동 · 작성 시각 '+short(original.start):resolution.message,()=>{this.selected=t.id;this.navigate(t.id,'view');},'fb-time-button');time.disabled=!linked;
      const line=el('p','fb-comment-line');line.append(time,document.createTextNode(' · '),el('span','fb-thread-body',t.body));card.append(line);
      if(!linked){const warning=el('small','fb-location-warning','위치 확인 필요');warning.title=resolution.message;card.append(warning);}
      const version=this.state.versions.find(v=>v.id===original.versionId),actions=el('div','fb-comment-actions');
      actions.append(btn('답글'+(t.replies.length?' '+t.replies.length:''),'답글 작성',()=>this.openReply(t.id),'fb-reply-button'),btn('버전 '+versionLabel(version),'작성 버전 '+versionLabel(version)+' · '+short(original.start)+'으로 이동',()=>{this.selected=t.id;this.navigate(t.id,'original');},'fb-origin-button'));
      if(this.preview)actions.append(btn('현재','현재 편집본에서 찾기',()=>this.navigate(t.id,'current'),'fb-current-button'));
      actions.append(btn('연결','영상 위치 다시 연결',()=>this.showRelink(t.id),'fb-relink-button'),btn('이력','상태·연결 이력 보기',()=>this.showHistory(t.id),'fb-history-button'),btn('삭제','댓글 삭제',()=>this.showDelete(t.id),'fb-delete-button'),btn('수정','댓글 수정',()=>this.showEdit(t.id),'fb-edit-button'));
      actions.querySelectorAll('button').forEach(n=>n.disabled=this.pending.size>0);card.append(actions);
      if(this.replyOpen.has(t.id)&&!this.replyOpen.get(t.id).parentId)card.append(this.replyForm(t));
      if(t.replies.length){const replies=el('div','fb-replies');this.replyTree(t,replies);card.append(replies);}
      return card;
    }
    openReply(threadId,parentId){this.replyOpen.set(threadId,{parentId});this.renderThreads();this.list.querySelector(`[data-thread="${threadId}"] .fb-reply-form textarea`)?.focus({preventScroll:true});}
    openDialog(kind,threadId,title,content){
      if(this.pending.size)return;this.closeDialog();this.dialogContext={kind,threadId};this.dialogOpener=document.activeElement;this.dialogTitle.textContent=title;this.dialogError.hidden=true;this.dialogContent.replaceChildren(content);this.dialog.showModal();
    }
    closeDialog(){
      if(!this.dialog?.open)return;const context=this.dialogContext,opener=this.dialogOpener;this.dialog.close();this.dialogContext=undefined;this.dialogContent.replaceChildren();
      const selector=context?.kind==='delete'?'.fb-delete-button':context?.kind==='edit'?'.fb-edit-button':context?.kind==='relink'?'.fb-relink-button':'.fb-history-button';const fallback=context&&this.list.querySelector(`[data-thread="${context.threadId}"] ${selector}`);(opener?.isConnected?opener:fallback)?.focus({preventScroll:true});
    }
    closeThreadDialog(kind,threadId){if(this.dialogContext?.kind===kind&&this.dialogContext.threadId===threadId)this.closeDialog();}
    showHistory(threadId){
      const thread=this.state.threads.find(t=>t.id===threadId);if(!thread)return;const list=el('ol','fb-history-list');
      for(const event of [...thread.events].reverse()){const row=el('li'),action=event.type==='created'?'등록 → '+event.to:event.type==='status'?event.from+' → '+event.to:event.type==='edited'?'댓글 수정':'위치 다시 연결 · '+event.note;row.append(el('strong','',action),el('span','',event.author.name+' · '+event.author.role),el('time','',date(event.at)));list.append(row);}
      this.openDialog('history',threadId,'상태·연결 이력',list);
    }
    showRelink(threadId){const thread=this.state.threads.find(t=>t.id===threadId);if(thread)this.openDialog('relink',threadId,'영상 위치 연결',this.relinkForm(thread));}
    showEdit(threadId){
      const thread=this.state.threads.find(t=>t.id===threadId);if(!thread||this.pending.size)return;
      const revision=this.state.revision,form=el('form','fb-edit-form'),textarea=el('textarea'),actions=el('div','fb-inline-actions');textarea.value=thread.body;textarea.maxLength=5000;textarea.required=true;textarea.rows=5;textarea.setAttribute('aria-label','댓글 수정');
      const cancel=btn('취소','댓글 수정 취소',()=>this.closeDialog(),'fb-edit-cancel'),submit=btn('저장','수정한 댓글 저장',null,'fb-edit-save');submit.type='submit';submit.disabled=true;
      textarea.oninput=()=>{submit.disabled=this.pending.size>0||!textarea.value.trim()||textarea.value.trim()===thread.body;};actions.append(cancel,submit);form.append(textarea,actions);
      form.onsubmit=event=>{event.preventDefault();if(this.pending.size||!textarea.value.trim()||textarea.value.trim()===thread.body)return;textarea.disabled=submit.disabled=true;this.request('edit',{threadId,body:textarea.value,expectedRevision:revision},()=>{this.closeThreadDialog('edit',threadId);this.notice('댓글을 수정했습니다.');});};
      this.openDialog('edit',threadId,'댓글 수정',form);textarea.focus({preventScroll:true});textarea.setSelectionRange(textarea.value.length,textarea.value.length);
    }
    showDelete(threadId){
      const thread=this.state.threads.find(t=>t.id===threadId);if(!thread||this.pending.size)return;const revision=this.state.revision,content=el('div','fb-delete-area');
      content.append(el('p','',thread.replies.length?`이 댓글과 답글 ${thread.replies.length}개를 삭제할까요?`:'이 댓글을 삭제할까요?'),el('small','','삭제한 내용은 되돌릴 수 없습니다.'));
      const actions=el('div','fb-inline-actions'),cancel=btn('취소','댓글 삭제 취소',()=>this.closeDialog(),'fb-delete-cancel'),confirm=btn('삭제','댓글과 답글 삭제',()=>{
        if(revision!==this.state.revision){this.dialogError.textContent='댓글이 변경되었습니다. 창을 닫고 내용을 확인한 뒤 다시 삭제하세요.';this.dialogError.hidden=false;confirm.disabled=true;return;}
        if(this.pending.size)return;confirm.disabled=true;
        this.request('delete',{threadId,expectedRevision:revision},()=>{this.closeThreadDialog('delete',threadId);this.replyOpen.delete(threadId);delete this.relinkDrafts[threadId];for(const key of Object.keys(this.replyDrafts))if(key.startsWith(threadId+':'))delete this.replyDrafts[key];if(this.selected===threadId)this.selected=undefined;this.save();this.notice('댓글을 삭제했습니다.');});
      },'fb-delete-confirm');actions.append(cancel,confirm);content.append(actions);this.openDialog('delete',threadId,'댓글 삭제',content);cancel.focus({preventScroll:true});
    }
    replyTree(thread, parent) {
      const stack=thread.replies.filter(r=>!r.parentId).reverse().map(reply=>({reply,depth:0}));while(stack.length){const {reply,depth}=stack.pop(),node=el('div','fb-reply');node.dataset.reply=reply.id;node.dataset.parent=reply.parentId||'';node.style.marginLeft=Math.min(depth,4)*7+'px';if(depth)node.append(el('small','fb-role','↳ '+(thread.replies.find(r=>r.id===reply.parentId)?.author.name||'답글')+'에게'));node.append(this.authorLine(reply.author,reply.at,true),el('p','fb-thread-body',reply.body),btn('답글','이 답글에 답하기',()=>this.openReply(thread.id,reply.id)));if(this.replyOpen.get(thread.id)?.parentId===reply.id)node.append(this.replyForm(thread));parent.append(node);for(const child of thread.replies.filter(r=>r.parentId===reply.id).reverse())stack.push({reply:child,depth:depth+1});}
    }
    replyForm(thread) {
      const parentId = this.replyOpen.get(thread.id)?.parentId, key = thread.id + ':' + (parentId || 'root'), form = el('form', 'fb-reply-form'), textarea = el('textarea'); textarea.maxLength = 5000; textarea.required = true; textarea.dataset.draftKey = key; textarea.setAttribute('aria-label', '스레드 답글'); textarea.value = this.replyDrafts[key] || ''; textarea.oninput = () => { this.replyDrafts[key] = textarea.value; this.save(); };
      if (parentId) { const reply = thread.replies.find(r => r.id === parentId); form.append(el('small', '', (reply?.author.name || '답글') + '에게 답하기')); }
      const actions = el('div', 'fb-inline-actions'), submit = btn('답글 저장', '', null); submit.type = 'submit'; submit.disabled = this.pending.size > 0; actions.append(submit, btn('취소', '', () => { this.replyOpen.delete(thread.id); this.renderThreads(); })); form.append(textarea, actions); form.onsubmit = e => { e.preventDefault(); this.request('reply', { threadId: thread.id, parentId, body: textarea.value }, () => { delete this.replyDrafts[key]; this.replyOpen.delete(thread.id); this.save(); this.notice('답글을 저장했습니다.'); }); }; return form;
    }
    relinkForm(thread) {
      const form = el('form', 'fb-relink-form'), context = this.options.context(), row = el('div', 'fb-relink-time'), start = el('input'), end = el('input'), note = el('textarea'), target = el('select');
      const draft = this.relinkDrafts[thread.id] ||= {versionId:context.versionId,start:stamp(context.time),end:'',clipId:context.activeClipId||'',note:''};
      Object.assign(start, { value: draft.start, required: true }); end.value=draft.end; note.value=draft.note; start.setAttribute('aria-label', '다시 연결할 시작 시각'); end.placeholder = '종료 (선택)'; end.setAttribute('aria-label', '다시 연결할 종료 시각'); row.append(start, end); note.placeholder = '이 장면으로 다시 연결하는 이유'; note.maxLength = 1000; note.required = true; note.setAttribute('aria-label', '위치 연결 변경 이유');
      const automatic = el('option', '', '자동 대상'); automatic.value = ''; target.append(automatic); for (const c of context.clips || []) { const option = el('option', '', c.trackId + ' · ' + (c.name || c.id)); option.value = c.id; target.append(option); } target.value = context.activeClipId || '';
      target.value=draft.clipId; for(const [name,field] of Object.entries({start,end,note,clipId:target})){field.dataset.draftKey='relink:'+thread.id+':'+name;field.addEventListener(name==='clipId'?'change':'input',()=>{draft[name]=field.value;this.save();});}
      const anchorVersion = draft.versionId, actions = el('div', 'fb-inline-actions'), submit = btn('이 장면에 연결', '', null); submit.type = 'submit'; submit.disabled = this.pending.size > 0 || anchorVersion!==context.versionId; actions.append(submit, btn('현재 시점으로 재지정', '', () => { const now=this.options.context();this.relinkDrafts[thread.id]={...draft,versionId:now.versionId,start:stamp(now.time),end:'',clipId:now.activeClipId||''};this.save();this.showRelink(thread.id); }), btn('취소', '', () => { this.closeThreadDialog('relink',thread.id); }));
      form.append(el('small', '', anchorVersion!==context.versionId?'편집 버전이 바뀌었습니다. 현재 시점으로 재지정하세요.':'보고 있는 버전의 위치를 직접 지정합니다. 최초 위치와 연결 이력은 보존됩니다.'), row, target, note, actions); form.onsubmit = e => { e.preventDefault(); try { if (anchorVersion !== this.options.context().versionId) throw Error('보는 버전이 바뀌었습니다. 현재 시점으로 재지정하세요.'); this.request('relink', { threadId: thread.id, versionId: anchorVersion, start: seconds(start.value, context.fps), ...(end.value.trim() ? { end: seconds(end.value, context.fps) } : {}), clipId: target.value || undefined, note: note.value }, () => { this.closeThreadDialog('relink',thread.id); delete this.relinkDrafts[thread.id];this.save(); this.notice('위치를 다시 연결했습니다. 최초 위치는 이력에 남아 있습니다.'); }); } catch (error) { this.notice(error.message, true);if(this.dialog.open){this.dialogError.textContent=error.message;this.dialogError.hidden=false;} } }; return form;
    }
    snapshot() { const visible=n=>n.getClientRects().length>0&&!n.closest('details:not([open])');return { open: this.opened, mode: this.state?.mode, revision: this.state?.revision, viewVersion: this.state?.viewVersion, preview: this.preview, threads: this.state?.threads || [], profile: this.state?.profile, pending: this.pending.size, draft: this.draft, notice: this.message.textContent, width: this.host.getBoundingClientRect().width,presentation:{versionLabel:this.host.querySelector('.fb-current-version').textContent,sort:this.host.querySelector('.fb-sort').value,settingsOpen:this.host.querySelector('.fb-settings').open,timeOptionsOpen:this.host.querySelector('.fb-time-options').open,comments:[...this.list.querySelectorAll('.fb-thread')].map(n=>({id:n.dataset.thread,author:n.querySelector('.fb-author-name').textContent,date:n.querySelector('.fb-date').textContent,time:n.querySelector('.fb-time-button').textContent,body:n.querySelector('.fb-thread-body').textContent,blocked:n.querySelector('.fb-time-button').disabled,status:n.querySelector('.fb-status-select').value,statusVisible:visible(n.querySelector('.fb-status-select')),replyCount:n.querySelectorAll('.fb-reply').length,version:n.querySelector('.fb-origin-button').textContent,actionsVisible:[...n.querySelectorAll('.fb-comment-actions button')].filter(visible).map(b=>b.className)})),dialog:this.dialog.open?{...this.dialogContext,bounds:this.dialog.getBoundingClientRect().toJSON()}:null,disclosureCount:this.list.querySelectorAll('details').length,listScrollTop:this.host.querySelector('.fb-body').scrollTop,listScrollHeight:this.host.querySelector('.fb-body').scrollHeight,visibleAdvanced:[...this.host.querySelectorAll('.fb-profile-form,.fb-time-fields,.fb-history,.fb-view-code')].filter(visible).length,listBounds:this.host.querySelector('.fb-body').getBoundingClientRect().toJSON(),composerBounds:this.form.getBoundingClientRect().toJSON()} }; }
  }
  window.CutlineFeedback = FeedbackPanel;
})();
