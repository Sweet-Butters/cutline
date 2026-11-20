/* Local review threads. No account, network synchronization or simulated presence. */
(function () {
  'use strict';
  const labels = ['수정 요청', '편집 중', '수정 완료', '편집 완료', '보류', '검토 완료'];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const btn = (text, title, fn, cls = '') => { const n = el('button', cls, text); n.type = 'button'; n.title = title || text; n.onclick = fn; return n; };
  const stamp = seconds => { const ms = Math.max(0, Math.round((seconds || 0) * 1000)), s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':') + '.' + String(ms % 1000).padStart(3, '0'); };
  const short = seconds => stamp(seconds).replace(/^00:/, '');
  function seconds(value, fps = 30) { const input = String(value).trim(); if (/^\d+(?:\.\d+)?$/.test(input)) return Number(input); const fields = input.split(':'); if (fields.length === 4 && fields.every(x => /^\d+$/.test(x)) && Number(fields[1]) < 60 && Number(fields[2]) < 60 && Number(fields[3]) < fps) return Number(fields[0]) * 3600 + Number(fields[1]) * 60 + Number(fields[2]) + Number(fields[3]) / fps; if ((fields.length === 2 || fields.length === 3) && fields.every(x => /^\d+(?:\.\d+)?$/.test(x)) && fields.slice(1).every(x => Number(x) < 60)) return fields.reduce((s, n) => s * 60 + Number(n), 0); throw Error('시간은 초 또는 00:01:20.000 형식으로 입력하세요.'); }
  const date = value => { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } };
  const versionLabel = version => version?.git?.length ? version.git[0].hash.slice(0, 8) : '미커밋 ' + (version?.id?.slice(0, 8) || '');

  class FeedbackPanel {
    constructor(options) {
      this.options = options; this.host = options.host; this.saved = options.saved || {}; this.opened = this.saved.open ?? innerWidth >= 1180; this.draft = this.saved.draft || { body: '', mode: 'point', status: labels[0], start: '', end: '', clipId: '', versionId: null,pinned:false }; this.replyDrafts = this.saved.replyDrafts || {};this.relinkDrafts=this.saved.relinkDrafts||{}; this.pending = new Map(); this.replyOpen = new Map(); this.relinkOpen = new Map(); this.limit = 20;
      this.build(); this.setOpen(this.opened); this.host.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { this.setOpen(false); document.getElementById('toggle-feedback')?.focus(); } });
      const timer=setInterval(()=>{if(this.opened&&this.state&&!this.draft.pinned&&!this.textarea.value&&!this.form.contains(document.activeElement)){const c=this.options.context();if(c.versionId===this.state.viewVersion.id){this.draft.start=this.start.value=stamp(c.time);this.draft.clipId=c.activeClipId||'';this.updateTargets();}}},250);window.addEventListener('pagehide',()=>clearInterval(timer));
    }
    build() {
      this.host.innerHTML = `<div class="fb-header"><strong>편집 피드백</strong><span class="fb-count">0</span></div><div class="fb-local"><b>이 컴퓨터에 저장</b> · 원격 동기화 없음</div><div class="fb-view"><span class="fb-view-label">편집 버전 확인 중</span><span class="fb-view-code"></span></div><div class="fb-body"><details class="fb-profile"><summary>작성자 설정</summary><form class="fb-profile-form"><label>표시 이름<input name="name" maxlength="60" required aria-label="피드백 작성자 이름"></label><label>역할<select name="role" aria-label="피드백 작성자 역할"><option>편집자</option><option>편집 제안자</option></select></label><button type="submit">작성자 저장</button></form><p class="fb-profile-note">이름·역할은 계정 인증이 없는 로컬 표시 정보입니다.</p></details><form class="fb-composer"><div class="fb-composer-heading"><strong>댓글 · 수정 요청</strong><span class="fb-counter">0 / 5000</span></div><textarea name="body" maxlength="5000" placeholder="어떤 장면을 어떻게 수정하면 좋을까요?" aria-label="새 편집 피드백" required></textarea><div class="fb-anchor-toolbar"><button type="button" data-capture="point">현재 시점</button><button type="button" data-capture="range">선택 구간</button><button type="button" data-mode="range">구간 지정</button></div><div class="fb-time-fields"><label>시작 시각<input name="start" placeholder="00:01:20.000" aria-label="피드백 시작 시각" required></label><span class="fb-range-only" hidden>–</span><label class="fb-range-only" hidden>종료 시각<input name="end" placeholder="00:01:23.000" aria-label="피드백 종료 시각"></label></div><select name="clipId" class="fb-target" aria-label="피드백 대상 클립"></select><p class="fb-anchor-version">현재 시점을 지정해 주세요.</p><div class="fb-compose-footer"><select name="status" aria-label="새 피드백 상태"></select><button type="submit">등록</button></div></form><div class="fb-status-message" role="status" aria-live="polite" hidden></div><div class="fb-filters"><input type="search" placeholder="내용·작성자 검색" aria-label="피드백 검색"><select class="fb-filter-status" aria-label="피드백 상태 필터"></select><select class="fb-filter-location" aria-label="피드백 위치 필터"><option value="all">모든 위치</option><option value="review">위치 확인 필요</option><option value="linked">연결된 위치</option></select><select class="fb-filter-version" aria-label="피드백 버전 필터"><option value="all">모든 작성 버전</option><option value="view">이 버전에 작성</option></select></div><div class="fb-list" aria-label="피드백 스레드"></div><p class="fb-storage-note">댓글·답글·상태·작성 버전은 프로젝트의 로컬 파일에 보존됩니다. 다른 PC와 실시간으로 공유되지 않습니다.</p></div>`;
      this.host.querySelector('.fb-header').append(btn('×', '피드백 패널 닫기', () => this.setOpen(false)));
      this.form = this.host.querySelector('.fb-composer'); this.textarea = this.form.elements.body; this.start = this.form.elements.start; this.end = this.form.elements.end; this.target = this.form.elements.clipId; this.message = this.host.querySelector('.fb-status-message'); this.list = this.host.querySelector('.fb-list');
      for (const status of labels) this.form.elements.status.append(el('option', '', status)); this.form.elements.status.value = this.draft.status;
      const filter = this.host.querySelector('.fb-filter-status'); const all = el('option', '', '모든 상태'); all.value = ''; filter.append(all); for (const status of labels) filter.append(el('option', '', status));
      this.textarea.value = this.draft.body; this.start.value = this.draft.start; this.end.value = this.draft.end;
      this.textarea.onfocus = () => { if (!this.draft.versionId||!this.draft.pinned) this.capture('point'); };
      this.textarea.oninput = () => { this.draft.body = this.textarea.value; this.updateComposer(); this.save(); };
      for (const field of [this.start, this.end]) field.oninput = () => { this.draft[field.name] = field.value;this.draft.pinned=true; this.updateComposer(); this.save(); };
      this.target.onchange = () => { this.draft.clipId = this.target.value;this.draft.pinned=true; this.save(); };
      this.form.elements.status.onchange = () => { this.draft.status = this.form.elements.status.value; this.save(); };
      for (const b of this.host.querySelectorAll('[data-capture]')) b.onclick = () => this.capture(b.dataset.capture);
      this.host.querySelector('[data-mode]').onclick = () => { this.draft.mode = this.draft.mode === 'range' ? 'point' : 'range'; if (!this.draft.versionId) this.capture('point'); if (!this.end.value) this.end.value = this.draft.end = stamp(Math.min(this.options.context().duration, seconds(this.start.value, this.options.context().fps) + 3)); this.updateComposer(); this.save(); };
      this.form.onsubmit = e => { e.preventDefault(); try { const location = this.location(); this.request('create', { body: this.textarea.value, status: this.form.elements.status.value, ...location }, () => { this.draft.body = ''; this.textarea.value = ''; this.draft.versionId = null; this.capture('point',false); this.save(); this.notice('피드백을 저장했습니다.'); }); } catch (error) { this.notice(error.message, true); } };
      const profile = this.host.querySelector('.fb-profile-form'); profile.onsubmit = e => { e.preventDefault(); this.request('profile', { name: profile.elements.name.value, role: profile.elements.role.value }, () => { this.host.querySelector('.fb-profile').open = false; this.notice('작성자 설정을 저장했습니다.'); }); };
      for (const field of this.host.querySelectorAll('.fb-filters input,.fb-filters select')) field.addEventListener(field.tagName === 'INPUT' ? 'input' : 'change', () => { this.limit = 20; this.renderThreads(); });
      this.updateComposer(); this.list.append(el('p', 'fb-loading', '로컬 피드백을 불러오는 중…'));
    }
    save() { this.options.onState?.({ open: this.opened, draft: this.draft, replyDrafts: this.replyDrafts,relinkDrafts:this.relinkDrafts }); }
    setOpen(open) { this.opened = open; document.body.classList.toggle('feedback-open', open); this.host.setAttribute('aria-hidden', String(!open)); document.getElementById('toggle-feedback')?.setAttribute('aria-expanded', String(open)); this.save(); if (open && !this.state) this.options.onLoad?.(); }
    toggle() { this.setOpen(!this.opened); }
    notice(text, error = false) { this.message.hidden = !text; this.message.textContent = text; this.message.classList.toggle('error', error); }
    updateComposer() {
      for (const n of this.form.querySelectorAll('.fb-range-only')) n.hidden = this.draft.mode !== 'range';
      this.form.querySelector('[data-mode]').classList.toggle('on', this.draft.mode === 'range'); this.host.querySelector('.fb-counter').textContent = this.textarea.value.length + ' / 5000';
      const stale = this.draft.versionId && this.state && this.draft.versionId !== this.state.viewVersion.id, label = this.form.querySelector('.fb-anchor-version'); label.classList.toggle('stale', !!stale);
      label.textContent = stale ? '편집 버전이 바뀌었습니다. 현재 시점을 다시 지정하세요. 작성 내용은 유지됩니다.' : this.draft.versionId ? '지정된 위치 · ' + (this.state ? versionLabel(this.state.versions.find(v => v.id === this.draft.versionId)) : this.draft.versionId.slice(0, 8)) : '현재 시점이나 구간을 지정하세요.';
      this.form.querySelector('[type="submit"]').disabled = !this.state || !!stale || !this.draft.versionId || !this.textarea.value.trim() || this.pending.size > 0;
    }
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
      this.options.onRequest({ action: 'mutate', requestId, input: { ...input, action, requestId, expectedRevision: this.state.revision } });
    }
    navigate(threadId, mode) {
      if (this.pending.size) return; const requestId = crypto.randomUUID(); this.pending.set(requestId, { action: 'navigate' }); this.updateComposer(); this.notice('편집 버전과 원본 위치를 확인 중…'); this.options.onRequest({ action: 'navigate', requestId, threadId, mode });
    }
    receive(message) {
      if (message.type === 'feedbackState') { this.accept(message); return; }
      if (message.type === 'feedbackError') { this.notice(message.message, true); return; }
      if (message.type !== 'feedbackResult') return;
      const pending = this.pending.get(message.requestId); if (!pending) return; this.pending.delete(message.requestId);
      if (message.state) this.accept(message);
      if (message.ok) { pending.success?.(); if (!pending.success) this.notice(pending.action === 'navigate' ? '지정한 버전의 위치로 이동했습니다.' : '저장했습니다.'); }
      else this.notice(message.message || '저장하지 못했습니다. 작성 내용은 유지됩니다.', true);
      this.updateComposer(); this.renderThreads(); this.save();
    }
    accept(message) {
      if (message.viewVersionId !== this.options.context().versionId) return;
      this.state = message.state; this.preview = message.preview; this.host.querySelector('.fb-count').textContent = this.state.threads.length;
      this.host.querySelector('.fb-view-label').textContent = this.preview ? '편집 버전 미리보기 · 읽기 전용' : '현재 편집본'; this.host.querySelector('.fb-view-code').textContent = versionLabel(this.state.viewVersion);
      let current = this.host.querySelector('.fb-view button'); if (this.preview && !current) this.host.querySelector('.fb-view').append(btn('현재 편집본', '작업 중인 편집본으로 돌아가기', () => this.options.onCurrent())); if (!this.preview && current) current.remove();
      const profile = this.host.querySelector('.fb-profile-form'); if (!profile.contains(document.activeElement)) { profile.elements.name.value = this.state.profile.name; profile.elements.role.value = this.state.profile.role; }
      this.host.querySelector('.fb-profile summary').textContent = this.state.profile.name + ' · ' + this.state.profile.role;
      if (!this.draft.versionId && !this.textarea.value) this.capture('point',false); else { this.updateTargets(); this.updateComposer(); }
      this.renderThreads();
    }
    renderThreads() {
      if (!this.state) return;
      const active = document.activeElement, focus = active?.dataset?.draftKey, selection = focus && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      const query = this.host.querySelector('.fb-filters input').value.trim().toLocaleLowerCase(), status = this.host.querySelector('.fb-filter-status').value, location = this.host.querySelector('.fb-filter-location').value, version = this.host.querySelector('.fb-filter-version').value;
      const threads = this.state.threads.filter(t => (!status || t.status === status) && (location === 'all' || (location === 'review') === (t.resolution.state === 'needs_review')) && (version === 'all' || t.anchors[0].anchor.versionId === this.state.viewVersion.id) && (!query || [t.body, t.author.name, ...t.replies.flatMap(r => [r.body, r.author.name])].join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      this.list.replaceChildren();
      if (!threads.length) { const empty = el('div', 'fb-empty'); empty.append(el('strong', '', this.state.threads.length ? '조건에 맞는 피드백이 없습니다.' : '장면에 의견을 남겨 보세요.'), document.createTextNode('시점이나 구간을 지정하면 편집 버전이 바뀌어도 원본 장면을 기준으로 연결합니다.')); this.list.append(empty); }
      for (const thread of threads.slice(0, this.limit)) this.list.append(this.renderThread(thread));
      if (threads.length > this.limit) this.list.append(btn('피드백 더 보기', '', () => { this.limit += 20; this.renderThreads(); }, 'fb-more'));
      if (focus) { const target = [...this.list.querySelectorAll('[data-draft-key]')].find(n => n.dataset.draftKey === focus); if (target) { target.focus({ preventScroll: true }); if (selection) target.setSelectionRange(...selection); } }
    }
    authorLine(author, at, compact = false) {
      const row = el('div', 'fb-author-row'), avatar = el('span', 'fb-avatar', [...author.name][0] || '?'), info = el('div', 'fb-author-info'), name = el('strong', 'fb-author-name', author.name); name.append(el('span', 'fb-role', author.role)); info.append(name, el('time', 'fb-date', date(at))); row.append(avatar, info); return row;
    }
    renderThread(t) {
      const card = el('article', 'fb-thread' + (t.resolution.state === 'needs_review' ? ' needs-review' : '') + (this.selected === t.id ? ' selected' : '')); card.dataset.thread = t.id;
      const author = this.authorLine(t.author, t.createdAt), status = el('select', 'fb-status-select'); status.setAttribute('aria-label', '스레드 상태'); for (const label of labels) status.append(el('option', '', label)); status.value = t.status; status.disabled = this.pending.size > 0; status.onchange = () => { const next = status.value; status.value = t.status; this.request('status', { threadId: t.id, status: next }); }; author.append(status); card.append(author, el('p', 'fb-thread-body', t.body));
      const original = t.anchors[0].anchor, resolution = t.resolution, location = el('div', 'fb-location');
      const time = btn(resolution.state === 'linked' ? short(resolution.start) + (resolution.end === undefined ? '' : ' – ' + short(resolution.end)) : '위치 확인 필요', '현재 보는 버전의 원본 장면으로 이동', () => { this.selected = t.id; this.navigate(t.id, 'view'); }, 'fb-time-button'); time.disabled = resolution.state !== 'linked'; location.append(time, btn('작성 버전 ' + short(original.start), '작성 당시 편집 버전과 시각으로 이동', () => { this.selected = t.id; this.navigate(t.id, 'original'); }, 'fb-origin-button')); card.append(location);
      const mapping = el('div', 'fb-mapping' + (resolution.state === 'needs_review' ? ' review' : ''));
      mapping.textContent = resolution.state === 'needs_review' ? resolution.message : resolution.method === 'manual' ? '수동 연결을 기준으로 찾은 장면' : original.start !== resolution.start ? `${short(original.start)} → ${short(resolution.start)} · 원본 장면으로 재연결` : '원본 장면 연결됨'; card.append(mapping);
      const actions = el('div', 'fb-location-actions'); actions.append(btn('현재 편집본에서 찾기', '', () => this.navigate(t.id, 'current')), btn('위치 다시 연결', '', () => { this.relinkOpen.set(t.id, !this.relinkOpen.get(t.id)); this.renderThreads(); })); card.append(actions);
      if (this.relinkOpen.get(t.id)) card.append(this.relinkForm(t));
      const footer = el('div', 'fb-thread-footer'); footer.append(btn('답글 ' + t.replies.length, '', () => { this.replyOpen.set(t.id, { parentId: undefined }); this.renderThreads(); })); const createdVersion = this.state.versions.find(v => v.id === original.versionId); footer.append(el('span', 'fb-thread-version', versionLabel(createdVersion))); card.append(footer);
      if (t.replies.length) { const replies = el('div', 'fb-replies'); this.replyTree(t, replies); card.append(replies); }
      if (this.replyOpen.has(t.id)) card.append(this.replyForm(t));
      const history = el('details', 'fb-history'); history.append(el('summary', '', '상태·연결 이력 ' + t.events.length)); const list = el('ol'); for (const event of [...t.events].reverse()) { const line = el('li'); line.append(document.createTextNode(`${event.author.name} · ${event.author.role} · ${event.type === 'created' ? '등록 → ' + event.to : event.type === 'status' ? event.from + ' → ' + event.to : '위치 다시 연결 · ' + event.note}`), el('time', '', date(event.at))); list.append(line); } history.append(list); card.append(history); return card;
    }
    replyTree(thread, parent) {
      const stack=thread.replies.filter(r=>!r.parentId).reverse().map(reply=>({reply,depth:0}));while(stack.length){const {reply,depth}=stack.pop(),node=el('div','fb-reply');node.dataset.reply=reply.id;node.dataset.parent=reply.parentId||'';node.style.marginLeft=Math.min(depth,4)*7+'px';if(depth)node.append(el('small','fb-role','↳ '+(thread.replies.find(r=>r.id===reply.parentId)?.author.name||'답글')+'에게'));node.append(this.authorLine(reply.author,reply.at,true),el('p','fb-thread-body',reply.body),btn('답글','이 답글에 답하기',()=>{this.replyOpen.set(thread.id,{parentId:reply.id});this.renderThreads();}));parent.append(node);for(const child of thread.replies.filter(r=>r.parentId===reply.id).reverse())stack.push({reply:child,depth:depth+1});}
    }
    replyForm(thread) {
      const parentId = this.replyOpen.get(thread.id)?.parentId, key = thread.id + ':' + (parentId || 'root'), form = el('form', 'fb-reply-form'), textarea = el('textarea'); textarea.maxLength = 5000; textarea.required = true; textarea.dataset.draftKey = key; textarea.setAttribute('aria-label', '스레드 답글'); textarea.value = this.replyDrafts[key] || ''; textarea.oninput = () => { this.replyDrafts[key] = textarea.value; this.save(); };
      if (parentId) { const reply = thread.replies.find(r => r.id === parentId); form.append(el('small', '', (reply?.author.name || '답글') + '에게 답하기')); }
      const actions = el('div', 'fb-inline-actions'), submit = btn('답글 저장', '', null); submit.type = 'submit'; submit.disabled = this.pending.size > 0; actions.append(submit, btn('취소', '', () => { this.replyOpen.delete(thread.id); this.renderThreads(); })); form.append(textarea, actions); form.onsubmit = e => { e.preventDefault(); this.request('reply', { threadId: thread.id, parentId, body: textarea.value }, () => { delete this.replyDrafts[key]; this.replyOpen.delete(thread.id); this.save(); this.notice('답글을 저장했습니다.'); }); }; return form;
    }
    relinkForm(thread) {
      const form = el('form', 'fb-relink-form'), context = this.options.context(), row = el('div', 'fb-relink-time'), start = el('input'), end = el('input'), note = el('textarea'), target = el('select');
      Object.assign(start, { value: stamp(context.time), required: true }); start.setAttribute('aria-label', '다시 연결할 시작 시각'); end.placeholder = '종료 (선택)'; end.setAttribute('aria-label', '다시 연결할 종료 시각'); row.append(start, end); note.placeholder = '이 장면으로 다시 연결하는 이유'; note.maxLength = 1000; note.required = true; note.setAttribute('aria-label', '위치 연결 변경 이유');
      const automatic = el('option', '', '자동 대상'); automatic.value = ''; target.append(automatic); for (const c of context.clips || []) { const option = el('option', '', c.trackId + ' · ' + (c.name || c.id)); option.value = c.id; target.append(option); } target.value = context.activeClipId || '';
      const anchorVersion = context.versionId, actions = el('div', 'fb-inline-actions'), submit = btn('이 장면에 연결', '', null); submit.type = 'submit'; submit.disabled = this.pending.size > 0; actions.append(submit, btn('취소', '', () => { this.relinkOpen.delete(thread.id); this.renderThreads(); }));
      form.append(el('small', '', '보고 있는 버전의 위치를 직접 지정합니다. 최초 위치와 연결 이력은 보존됩니다.'), row, target, note, actions); form.onsubmit = e => { e.preventDefault(); try { if (anchorVersion !== this.options.context().versionId) throw Error('보는 버전이 바뀌었습니다. 다시 연결 창을 다시 열어 주세요.'); this.request('relink', { threadId: thread.id, versionId: anchorVersion, start: seconds(start.value, context.fps), ...(end.value.trim() ? { end: seconds(end.value, context.fps) } : {}), clipId: target.value || undefined, note: note.value }, () => { this.relinkOpen.delete(thread.id); this.notice('위치를 다시 연결했습니다. 최초 위치는 이력에 남아 있습니다.'); }); } catch (error) { this.notice(error.message, true); } }; return form;
    }
    snapshot() { return { open: this.opened, mode: this.state?.mode, revision: this.state?.revision, viewVersion: this.state?.viewVersion, preview: this.preview, threads: this.state?.threads || [], profile: this.state?.profile, pending: this.pending.size, draft: this.draft, notice: this.message.textContent, width: this.host.getBoundingClientRect().width }; }
  }
  window.CutlineFeedback = FeedbackPanel;
})();
