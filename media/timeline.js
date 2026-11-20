/* Premiere-style time-based editing, with a shared validated sequence model. */
(function () {
  'use strict';
  const M = window.CutlineSequence;
  const SVG = 'http://www.w3.org/2000/svg';
  const paths = {
    select: 'M5 3v17l4-5 4 7 3-2-4-6 7-1Z', track: 'M3 6h18M3 12h18M3 18h18M7 3v18',
    ripple: 'M4 4v16m16-16v16M8 12h8m-5-4-4 4 4 4m2-8 4 4-4 4', roll: 'M12 3v18M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4',
    razor: 'm4 16 12-12 5 5-12 12H4Zm6-6 5 5', slip: 'M4 5v14m16-14v14M7 12h10m-7-3-3 3 3 3m4-6 3 3-3 3',
    slide: 'M3 6h5v12H3m18-12h-5v12h5M9 12h6m-4-3-3 3 3 3m2-6 3 3-3 3', pen: 'm5 20 3-8L18 2l4 4-10 10Zm3-8 4 4M5 20l7-4',
    rect: 'M4 5h16v14H4Z', hand: 'M7 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-4-2-6-4L3 13a2 2 0 0 1 3-2l2 3',
    text: 'M4 4h16M12 4v17M8 21h8', snap: 'M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4ZM5 8h4m6 0h4',
    link: 'm9 15 6-6M8 13l-2 2a3 3 0 0 0 4 4l3-3m-2-8 2-2a3 3 0 0 1 4 4l-2 2', marker: 'M6 3h12v11l-6 6-6-6Z',
    settings: 'M4 7h16M4 17h16M8 4v6m8 4v6', undo: 'm8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4', redo: 'm16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v4',
    lock: 'M6 11h12v10H6ZM8 11V6a4 4 0 0 1 8 0v5', unlock: 'M6 11h12v10H6Zm2 0V6a4 4 0 0 1 8 0',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    mic: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0Zm-3 7v1a6 6 0 0 0 12 0v-1m-6 7v4m-4 0h8',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7', split: 'M12 3v18M4 7h5v10H4Zm11 0h5v10h-5Z',
    fit: 'M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4', plus: 'M12 4v16M4 12h16', minus: 'M4 12h16',
    import: 'M12 2v13m-5-5 5 5 5-5M4 16v5h16v-5', cc: 'M3 5h18v14H3Zm7 4H7v6h3m7-6h-3v6h3'
  };
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function icon(name) { const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', paths[name] || paths.select); svg.append(p); return svg; }
  function button(name, title, click, text) { const b = el('button', '', text); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); if (text === undefined) b.append(icon(name)); b.onclick = click; return b; }
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  class SequencePlayer {
    constructor(canvas, onTime, onPlayback, onMeter, onError) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onTime = onTime; this.onPlayback = onPlayback; this.onMeter = onMeter; this.onError = onError;
      this.nodes = new Map(); this.time = 0; this.playing = false; this.enabled = false; this.generation = 0;
      this.pool = el('div', 'te-media-pool'); canvas.parentElement.append(this.pool);
      const tick = () => { if (this.enabled) this.tick(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      // Chromium suspends animation frames for an occluded editor window. Keep
      // transport time/cut changes moving while native media is still playing.
      this.transportTimer=setInterval(()=>{if(this.enabled&&this.playing&&performance.now()-(this.lastTick||0)>100)this.tick();},100);
      window.addEventListener('pagehide',()=>{clearInterval(this.transportTimer);this.pause();});
    }
    audioGraph() {
      if (this.audio) { this.audio.resume(); return; }
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('이 브라우저는 Web Audio를 지원하지 않습니다');
      this.audio = new Audio(); this.master = this.audio.createGain(); this.master.connect(this.audio.destination);
      const splitter = this.audio.createChannelSplitter(2); this.master.connect(splitter);
      this.analysers = [0, 1].map(i => { const a = this.audio.createAnalyser(); a.fftSize = 1024; splitter.connect(a, i); return a; });
      this.audio.resume();
    }
    legacyAudio(video) {
      try { this.audioGraph(); if (!this.legacy) { this.legacy = this.audio.createMediaElementSource(video); this.legacy.connect(this.master); } this.meter(); } catch (e) { this.onError(e.message); }
    }
    set(seq, assets, enabled) {
      this.pause(); this.seq = seq; this.assets = assets; this.enabled = enabled; this.canvas.hidden = !enabled;if(this.master)this.master.gain.value=Math.pow(10,seq.mixDb/20);
      const keep = new Set(seq.items.map(c => c.id));
      for (const [id, node] of this.nodes) if (!keep.has(id) || assets[node.source]?.url !== node.el.getAttribute('src')) { node.el.pause(); node.gain?.disconnect(); node.sourceNode?.disconnect(); node.el.remove(); this.nodes.delete(id); }
      this.time = clamp(this.time, 0, M.duration(seq)); if (enabled) this.seek(this.time);
    }
    node(c) {
      if (this.nodes.has(c.id)) return this.nodes.get(c.id);
      const asset = this.assets[c.source]; if (!asset || (c.kind === 'audio' && !asset.audio)) return null;
      const media = document.createElement(c.kind === 'video' ? 'video' : 'audio'); media.preload = 'auto'; media.crossOrigin = 'anonymous'; media.muted = c.kind === 'video'; media.playsInline = true;
      const node = { el: media, source: c.source, announced: false }; this.nodes.set(c.id, node); this.pool.append(media);
      media.onloadedmetadata = () => { if (c.kind === 'video') this.onPlayback('loadedmetadata', c.source, { duration: media.duration, width: media.videoWidth, height: media.videoHeight }); this.sync(false); this.draw(); };
      media.oncanplay = () => { if (c.kind === 'video' && !node.announced) { node.announced = true; this.onPlayback('canplay', c.source, {}); } this.draw(); };
      media.onseeked = () => this.draw(); media.onerror = () => { this.pause(); this.onPlayback('error', c.source, { message: media.error?.message || '미디어를 열 수 없습니다' }); };
      media.src = asset.url; media.load(); return node;
    }
    active() { return this.seq.items.filter(c => this.time >= c.start - 1e-7 && this.time < M.end(c) - 1e-7); }
    sync(run) {
      if (!this.enabled) return;
      const active = this.active(), ids = new Set(active.map(c => c.id));
      if (this.master) this.master.gain.value = Math.pow(10, this.seq.mixDb / 20);
      for (const [id, node] of this.nodes) if (!ids.has(id)) node.el.pause();
      for (const c of active.filter(c => c.kind === 'audio' || c.kind === 'video')) {
        const track = this.seq.tracks.find(t => t.id === c.trackId), audible = c.kind === 'audio' && M.audible(this.seq, track);
        if (c.kind === 'video' && track.visible === false) continue;
        const node = this.node(c); if (!node) continue;
        const target = c.in + this.time - c.start;
        if (node.el.readyState && !node.el.seeking && Math.abs(node.el.currentTime - target) > (run ? .18 : .015)) node.el.currentTime = target;
        if (c.kind === 'audio' && this.audio) {
          node.el.muted=!audible;
          if (!node.gain) { node.sourceNode = this.audio.createMediaElementSource(node.el); node.gain = this.audio.createGain(); node.sourceNode.connect(node.gain); node.gain.connect(this.master); }
          node.gain.gain.value = audible ? Math.pow(10, (M.volumeAt(c, this.time - c.start) + (track.gainDb || 0)) / 20) : 0;
        }
        if(c.kind==='audio'&&!audible){node.el.pause();continue;}
        if (run && node.el.paused && node.el.readyState >= 2 && !node.el.seeking) node.el.play().catch(e => {this.lastError={id:c.id,kind:c.kind,muted:node.el.muted,message:e.message}; this.pause(); this.onError('재생을 다시 눌러 주세요: ' + e.message); });
        if (!run) node.el.pause();
      }
    }
    seek(time) { this.time = clamp(time, 0, M.duration(this.seq)); this.anchor = this.time; this.wall = performance.now(); this.sync(this.playing); this.draw(); this.onTime(this.time, this.playing); }
    play() { if (!this.enabled) return; this.audioGraph(); if (this.time >= M.duration(this.seq) - .01) this.time = 0; this.playing = true; this.anchor = this.time; this.wall = performance.now(); this.sync(true); this.onTime(this.time, true); }
    pause() { this.playing = false; for (const node of this.nodes.values()) node.el.pause(); if (this.seq && this.enabled) this.onTime(this.time, false); this.onMeter([-Infinity, -Infinity]); }
    tick() {
      this.lastTick=performance.now();
      if (this.playing) { this.time = Math.min(M.duration(this.seq), this.anchor + (performance.now() - this.wall) / 1000); if (this.time >= M.duration(this.seq)) this.pause(); }
      this.sync(this.playing); this.draw(); this.meter(); this.onTime(this.time, this.playing);
    }
    draw() {
      if (!this.enabled) return;
      const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height; ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const active = this.active().filter(c => c.kind !== 'audio' && this.seq.tracks.find(t => t.id === c.trackId)?.visible !== false).sort((a, b) => this.seq.tracks.find(t => t.id === b.trackId).order - this.seq.tracks.find(t => t.id === a.trackId).order);
      for (const c of active) {
        const style = c.style || {}, x = (style.x ?? .5) * w, y = (style.y ?? (c.kind === 'text' ? .85 : .5)) * h;
        ctx.save(); ctx.globalAlpha = M.opacityAt(c,this.time-c.start) * (style.opacity ?? 1);
        if (c.kind === 'video') {
          const node = this.node(c), media = node?.el; if (media?.readyState >= 2 && media.videoWidth) { const maxW = (style.width ?? 1) * w, maxH = (style.height ?? 1) * h, ratio = Math.min(maxW / media.videoWidth, maxH / media.videoHeight), dw = media.videoWidth * ratio, dh = media.videoHeight * ratio; ctx.filter = `brightness(${c.effects?.brightness ?? 1})`; ctx.drawImage(media, x - dw / 2, y - dh / 2, dw, dh); }
        } else if (c.kind === 'shape') { const dw = (style.width ?? .3) * w, dh = (style.height ?? .15) * h; ctx.fillStyle = style.color || '#70c8ff'; ctx.fillRect(x - dw / 2, y - dh / 2, dw, dh); }
        else { ctx.font = `${style.fontSize || 42}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = style.color || '#ffffff'; const lines = (c.text || '').split('\n'); lines.forEach((line, i) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * (style.fontSize || 42) * 1.25)); }
        ctx.restore();
      }
    }
    meter() {
      if (!this.analysers || (!this.playing && !this.legacy)) return;
      const levels = this.analysers.map(a => { const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data); const power = data.reduce((sum, n) => sum + n * n, 0) / data.length; return power > 1e-12 ? 10 * Math.log10(power) : -Infinity; }); this.onMeter(levels);
    }
    snapshot() { return { time: this.time, playing: this.playing,lastError:this.lastError, frames: [...this.nodes.values()].reduce((n, x) => n + (x.el.getVideoPlaybackQuality?.().totalVideoFrames || 0), 0), active: this.active().map(c => c.id), gains: [...this.nodes].filter(([, n]) => n.gain).map(([id, n]) => ({ id, value: n.gain.gain.value })) }; }
  }

  class TimelineEditor {
    constructor(options) {
      this.options = options; this.host = options.host; this.head = 0; this.ids = []; this.seq = M.fromTimeline({ clips: [] }); this.assets = {}; this.disabled = false; this.canUndo = false; this.canRedo = false;
      this.view = { tool: 'select', pps: null, snap: true, linked: true, thumbs: true, waveform: true, follow: true, height: Math.max(170,Math.min(245,innerHeight*.26)), ...options.view }; this.build();
      this.player = new SequencePlayer(document.getElementById('sequence-preview'), (time, playing) => { this.setTime(time, playing); this.options.onPlaybackTime?.(time, playing); }, (event, source, extra) => this.options.onPlayback?.(event, source, extra), levels => this.meter(levels), message => this.status(message));
      this.previewTools(); this.keyboard();
      new ResizeObserver(() => { if (this.seq) this.renderRuler(); this.navigator(); }).observe(this.scroll);
    }
    build() {
      this.host.innerHTML = `<div class="te-resize" title="타임라인 높이 조절"></div><div class="te-titlebar"><span class="te-tab-dot"></span><strong></strong><span class="te-sequence-kind">SEQUENCE</span><span class="te-save-state">● 저장됨</span></div><div class="te-toolbar"></div><div class="te-body"><nav class="te-rail" aria-label="편집 도구"></nav><div class="te-scroll" tabindex="0" aria-label="타임라인 시간 및 트랙"><div class="te-sheet"></div></div><aside class="te-meter" aria-label="실시간 스테레오 출력 레벨"><span class="te-meter-label">MIX</span><div class="te-meter-scale"><div class="te-meter-bars"><div class="te-meter-channel"><div class="te-meter-fill"></div><div class="te-meter-peak"></div></div><div class="te-meter-channel"><div class="te-meter-fill"></div><div class="te-meter-peak"></div></div></div></div><span class="te-meter-value">−∞</span><input type="number" min="-60" max="12" step="0.5" value="0" title="마스터 출력 게인 (dB)" aria-label="마스터 출력 게인 dB"><span class="te-meter-label">dBFS</span></aside></div><div class="te-footer"><span class="te-status">준비됨</span><input class="te-navigator" type="range" min="0" max="0" value="0" aria-label="보이는 시간 구간 이동"><span class="te-help">Space 재생 · C 자르기 · ⌘Z 되돌리기</span></div><dialog class="te-dialog"></dialog>`;
      this.host.style.position = 'relative'; this.host.style.setProperty('--te-height', this.view.height + 'px');
      this.scroll = this.host.querySelector('.te-scroll'); this.sheet = this.host.querySelector('.te-sheet'); this.toolbar = this.host.querySelector('.te-toolbar'); this.rail = this.host.querySelector('.te-rail'); this.dialog = this.host.querySelector('dialog');
      this.scroll.onscroll = () => {this.navigator();if(!this.rulerFrame)this.rulerFrame=requestAnimationFrame(()=>{this.rulerFrame=0;this.renderRuler();});};
      this.scroll.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); this.zoom(this.view.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); } else if (e.shiftKey) { e.preventDefault(); this.scroll.scrollLeft += e.deltaY; } }, { passive: false });
      this.host.querySelector('.te-navigator').oninput = e => this.scroll.scrollLeft = Number(e.target.value);
      this.host.querySelector('.te-meter input').onchange = e => this.edit({ action: 'settings', patch: { mixDb: Number(e.target.value) } });
      const scale = this.host.querySelector('.te-meter-scale'); for (let db = 0; db >= -54; db -= 6) { const tick = el('span', 'te-db-tick', String(db)); tick.style.top = ((-db / 54) * 100) + '%'; scale.append(tick); }
      const resize = this.host.querySelector('.te-resize'); resize.onpointerdown = e => { e.preventDefault(); const y = e.clientY, height = this.view.height; this.drag(e, move => { this.view.height = clamp(height + move.clientY - y, 170, innerHeight * .7); this.host.style.setProperty('--te-height', this.view.height + 'px'); }, () => this.saveView()); };
      this.toolButtons = new Map();
      for (const [tool, label] of [['select', '선택 V'], ['track', '트랙 선택 A'], ['ripple', '리플 트림 B'], ['roll', '롤 트림 N'], ['razor', '자르기 C'], ['slip', '슬립 Y'], ['slide', '슬라이드 U'], ['pen', '볼륨 키프레임 P'], ['rect', '도형 R'], ['hand', '손 H'], ['text', '자막 T']]) {
        const b = button(tool, label, () => this.setTool(tool)); b.dataset.tool = tool; this.rail.append(b); this.toolButtons.set(tool, b);
      }
      this.rail.append(el('hr')); this.rail.append(button('import', '영상 또는 오디오 가져오기', () => this.importMedia()));
      this.toolbarButtons = {};
      this.clock = button(null, '재생 헤드 시간 이동', () => this.timeDialog(), '00:00:00:00'); this.clock.className = 'te-timecode'; this.toolbar.append(this.clock);
      const add = (id, iconName, title, action, text) => { const b = button(iconName, title, action, text); b.dataset.control = id; this.toolbar.append(b); this.toolbarButtons[id] = b; return b; };
      add('snap', 'snap', '스냅 켜기/끄기 · 클립 경계·마커·재생 헤드에 정렬', () => { this.view.snap = !this.view.snap; this.updateControls(); this.saveView(); });
      add('linked', 'link', '영상·오디오 연결 선택 켜기/끄기', () => { this.view.linked = !this.view.linked; this.updateControls(); this.saveView(); });
      add('marker', 'marker', '현재 시간에 마커 추가 M', () => this.markerDialog());
      add('cc', 'cc', '자막 표시 켜기/끄기', () => { const t = this.seq.tracks.find(t => t.kind === 'caption'); if (t) this.edit({ action: 'track', trackId: t.id, patch: { visible: t.visible === false } }); });
      add('settings', 'settings', '표시 옵션 · 썸네일·파형·트랙 추가', () => this.settings());
      this.toolbar.append(el('span', 'te-divider'));
      add('split', 'split', '재생 헤드에서 분할 S', () => this.editSelected('split'));
      add('delete', 'trash', '선택 삭제 · Shift+Delete 리플 삭제', () => this.editSelected('delete'));
      add('undo', 'undo', '실행 취소 ⌘Z', () => this.options.onHistory('undo'));
      add('redo', 'redo', '다시 실행 ⇧⌘Z', () => this.options.onHistory('redo'));
      this.toolbar.append(el('span', 'te-toolbar-spacer'));
      this.toolLabel = el('span', 'te-tool-label', '선택'); this.toolbar.append(this.toolLabel);
      const zoom = el('div', 'te-zoom'); zoom.append(button('minus', '축소 -', () => this.zoom(this.view.pps / 1.5)));
      this.zoomRange = el('input'); Object.assign(this.zoomRange, { type: 'range', min: 0, max: 100, value: 50 }); this.zoomRange.setAttribute('aria-label', '타임라인 확대 비율'); this.zoomRange.oninput = () => this.zoom(.02 * Math.pow(15000, Number(this.zoomRange.value) / 100)); zoom.append(this.zoomRange, button('plus', '확대 +', () => this.zoom(this.view.pps * 1.5)), button('fit', '전체 시퀀스 보기 \\', () => this.fit()));
      this.zoomValue = el('span', 'te-zoom-value'); zoom.append(this.zoomValue); this.toolbar.append(zoom); this.setTool(this.view.tool);
    }
    saveView() { this.options.onView?.(this.view); }
    status(text) { this.host.querySelector('.te-status').textContent = text; this.host.querySelector('.te-status').title = text; }
    setTool(tool) { this.view.tool = tool; for (const [id, b] of this.toolButtons) b.classList.toggle('on', id === tool); if (this.toolLabel) this.toolLabel.textContent = { select: '선택', track: '트랙 선택', ripple: '리플 트림', roll: '롤 트림', razor: '자르기', slip: '슬립', slide: '슬라이드', pen: '볼륨 키프레임', rect: '도형', hand: '손', text: '자막' }[tool]; this.overlay?.classList.toggle('drawing', ['rect', 'text'].includes(tool)); this.saveView(); }
    setDocument(timeline, assets, diff, projectName) {
      this.timeline = timeline; this.seq = M.fromTimeline(timeline); this.assets = assets || {}; this.diff = diff; this.advanced = !!timeline.sequence; this.pending = false;
      if (!timeline.sequence && this.seq.name === 'Sequence 01') this.seq.name = projectName || 'Sequence 01';
      this.ids = this.ids.filter(id => this.seq.items.some(c => c.id === id)); if (!this.ids.length && this.seq.items.length) this.ids = [this.seq.items.find(c => c.kind === 'video')?.id || this.seq.items[0].id];
      if (!this.view.pps) this.view.pps = Math.max(.02, (this.scroll.clientWidth - this.headerWidth()) / Math.max(10, M.duration(this.seq) + 5));
      this.host.querySelector('.te-titlebar strong').textContent = this.seq.name; this.host.querySelector('.te-meter input').value = this.seq.mixDb;
      const oldHead=this.head;this.player.set(this.seq, this.assets, this.advanced);if(this.advanced)this.player.seek(oldHead);document.getElementById('video').hidden = this.advanced;
      this.render();if(!this.hasDocument&&this.ids.length){const item=this.seq.items.find(c=>c.id===this.ids[0]),row=[...this.sheet.querySelectorAll('.te-row')].find(n=>n.dataset.track===item?.trackId);if(row)this.scroll.scrollTop=Math.max(0,row.offsetTop-54);}this.hasDocument=true;this.updateControls(); this.status(this.advanced ? '저장됨 · ' + M.timecode(M.duration(this.seq), this.seq.fps) : '기존 편집 유지 · 트랙 편집 시 자동 저장');
      this.host.querySelector('.te-save-state').textContent = '● 저장됨';
    }
    setBusy(value, undo, redo) { this.disabled = value; this.canUndo = undo; this.canRedo = redo; if (!value) this.pending = false; this.updateControls(); }
    updateControls() {
      if (!this.toolbarButtons) return;
      const blocked = this.disabled || this.pending;
      for (const id of ['marker', 'split', 'delete', 'cc']) this.toolbarButtons[id].disabled = blocked;
      this.toolbarButtons.undo.disabled = blocked || !this.canUndo; this.toolbarButtons.redo.disabled = blocked || !this.canRedo;
      this.toolbarButtons.snap.classList.toggle('on', this.view.snap); this.toolbarButtons.linked.classList.toggle('on', this.view.linked);
      this.toolbarButtons.cc.classList.toggle('on', this.seq.tracks.some(t => t.kind === 'caption' && t.visible !== false));
    }
    edit(operation) {
      if (this.disabled || this.pending) { this.status('편집 완료 후 현재 버전에서 다시 시도하세요'); return; }
      try { const next = M.operate(this.seq, operation); if (JSON.stringify(next) === JSON.stringify(this.seq)) return; for (const c of next.items.filter(c => c.source)) if (this.assets[c.source] && c.out > this.assets[c.source].duration + .025) throw Error('트림 범위가 원본 길이를 넘습니다'); }
      catch (e) { this.status(e.message); this.options.onStatus?.(e.message); return; }
      this.pending = true; this.player.pause(); this.options.onPause?.(); this.host.querySelector('.te-save-state').textContent = '◌ 저장 중'; this.updateControls(); this.options.onEdit(operation);
    }
    selected() { return M.selected(this.seq, this.ids, this.view.linked); }
    select(ids, toggle = false) {
      this.ids = toggle ? [...new Set([...this.ids.filter(id => !ids.includes(id)), ...ids.filter(id => !this.ids.includes(id))])] : ids;
      for (const n of this.sheet.querySelectorAll('.te-clip')) n.classList.toggle('selected', this.selected().some(c => c.id === n.dataset.id));
      const first = this.seq.items.find(c => c.id === this.ids[0]); if (first) { this.options.onSelect?.(first); this.status((first.name || first.id) + ' · ' + M.timecode(first.start, this.seq.fps) + ' → ' + M.timecode(M.end(first), this.seq.fps)); }
    }
    editSelected(action, extra = {}) { let ids = this.ids; if (!ids.length) ids = this.seq.items.filter(c => c.start <= this.head && M.end(c) > this.head && this.seq.tracks.find(t => t.id === c.trackId)?.targeted).map(c => c.id); this.edit({ action, ids, linked: this.view.linked, time: this.head, ...extra }); }
    headerWidth() { return parseFloat(getComputedStyle(this.host).getPropertyValue('--te-header')) || 140; }
    worldWidth() { return Math.max(this.scroll.clientWidth - this.headerWidth(), (M.duration(this.seq) + Math.max(5, M.duration(this.seq) * .08)) * this.view.pps); }
    timeAt(event) { const ruler = this.sheet.querySelector('.te-ruler'); return Math.max(0, (event.clientX - ruler.getBoundingClientRect().left) / this.view.pps); }
    seek(time) { time = M.frame(clamp(time, 0, M.duration(this.seq)), this.seq.fps); if (this.advanced) this.player.seek(time); else this.options.onSeek(time); this.setTime(time, false); }
    setTime(time, playing) {
      this.head = time; this.clock.textContent = M.timecode(time, this.seq.fps); if (this.playhead) this.playhead.style.left = (this.headerWidth() + time * this.view.pps) + 'px';
      if (playing && this.view.follow) { const x = time * this.view.pps, width = this.scroll.clientWidth - this.headerWidth(); if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + width - 20) this.scroll.scrollLeft = Math.max(0, x - width * .2); }
      if (!this.advanced) this.player.meter();
    }
    render() {
      const left = this.scroll.scrollLeft, top = this.scroll.scrollTop; this.sheet.replaceChildren(); this.host.style.setProperty('--te-world', this.worldWidth() + 'px');
      const rulerRow = el('div', 'te-ruler-row'), corner = el('div', 'te-ruler-corner'); corner.append(el('span', '', 'SOURCE / TARGET'), button('plus', '트랙 추가', () => this.settings())); this.ruler = el('div', 'te-ruler'); rulerRow.append(corner, this.ruler); this.sheet.append(rulerRow);
      this.ruler.onpointerdown = e => { if (e.target.closest('.te-marker')) return; e.preventDefault(); this.options.onPause?.(); this.player.pause(); this.seek(this.timeAt(e)); this.drag(e, move => this.seek(this.timeAt(move))); };
      for (const t of [...this.seq.tracks].sort((a, b) => a.order - b.order)) this.renderTrack(t);
      this.playhead = el('div', 'te-playhead'); this.sheet.append(this.playhead); this.snapLine = el('div', 'te-snap-line'); this.snapLine.hidden = true; this.sheet.append(this.snapLine);
      this.renderRuler(); this.scroll.scrollLeft = left; this.scroll.scrollTop = top; this.setTime(this.head, false); this.navigator();
    }
    renderRuler() {
      if (!this.ruler) return; this.ruler.replaceChildren();
      const pps = this.view.pps, choices = [1 / this.seq.fps, .1, .25, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600], step = choices.find(s => s * pps >= 72) || 3600;
      this.host.style.setProperty('--grid-size', step * pps + 'px');
      const min=Math.max(0,Math.floor(this.scroll.scrollLeft/pps/step)*step),max = Math.min(this.worldWidth()/pps,(this.scroll.scrollLeft+this.scroll.clientWidth)/pps+step);
      for (let time = min; time <= max; time += step / 4) { const major = Math.abs(time / step - Math.round(time / step)) < .001, tick = el('div', 'te-tick' + (major ? '' : ' minor')); tick.style.left = time * pps + 'px'; if (major) tick.append(el('span', '', M.timecode(time, this.seq.fps))); this.ruler.append(tick); }
      for (const marker of this.seq.markers) { const b = button(null, marker.label + ' · ' + M.timecode(marker.time, this.seq.fps), () => this.seek(marker.time), ''); b.className = 'te-marker'; b.style.left = marker.time * pps + 'px'; b.ondblclick = () => this.markerDialog(marker); this.ruler.append(b); }
      for (const c of this.seq.items.filter(c => c.kind === 'video')) { const line = el('span', 'te-render-state' + (this.assets[c.source] ? '' : ' pending')); line.style.left = c.start * pps + 'px'; line.style.width = M.length(c) * pps + 'px'; line.title = this.assets[c.source] ? '재생 프록시 준비됨' : '재생 프록시 준비 중'; this.ruler.append(line); }
      this.zoomRange.value = String(Math.log(pps / .02) / Math.log(15000) * 100); this.zoomValue.textContent = pps.toFixed(pps < 1 ? 2 : 0) + 'px/s';
    }
    renderTrack(t) {
      const row = el('div', 'te-row' + (t.locked ? ' locked' : '')); row.dataset.track = t.id; row.dataset.kind = t.kind; row.style.setProperty('--row-height', t.height + 'px');
      const head = el('div', 'te-head' + (t.locked ? ' locked' : '')), top = el('div', 'te-head-top'), bottom = el('div', 'te-head-bottom');
      const patch = button(null, '소스 삽입 대상 ' + t.name, () => this.edit({ action: 'track', trackId: t.id, patch: { sourceTarget: !t.sourceTarget } }), t.name); patch.className = 'te-source-patch' + (t.sourceTarget ? ' on' : '');
      const target = button(null, '편집 타기팅 ' + t.name, () => this.edit({ action: 'track', trackId: t.id, patch: { targeted: !t.targeted } }), t.name); target.className = 'te-target' + (t.targeted ? ' on' : '');
      top.append(t.kind==='caption'?el('span','te-head-name','CC'):patch, target, button(t.locked ? 'lock' : 'unlock', t.locked ? '트랙 잠금 해제' : '트랙 잠금', () => this.edit({ action: 'track', trackId: t.id, patch: { locked: !t.locked } })));
      if (t.kind !== 'audio') { const b = button('eye', '영상 표시/숨김 ' + t.name, () => this.edit({ action: 'track', trackId: t.id, patch: { visible: t.visible === false } })); b.classList.toggle('on', t.visible !== false); top.append(b); }
      if (t.kind === 'audio') {
        for (const [key, label] of [['muted', 'M'], ['solo', 'S']]) { const b = button(null, (key === 'muted' ? '음소거 ' : '솔로 ') + t.name, () => this.edit({ action: 'track', trackId: t.id, patch: { [key]: !t[key] } }), label); b.classList.toggle('on', !!t[key]); bottom.append(b); }
        const mic = button('mic', '보이스오버 녹음 ' + t.name, () => this.record(t, mic)); if (this.recording?.trackId === t.id) mic.classList.add('te-recording'); bottom.append(mic);
        const gain = el('input', 'te-track-gain'); Object.assign(gain, { type: 'number', min: -60, max: 12, step: .5, value: t.gainDb || 0 }); gain.title = t.name + ' 게인 dB'; gain.setAttribute('aria-label', gain.title); gain.onchange = () => this.edit({ action: 'track', trackId: t.id, patch: { gainDb: Number(gain.value) } }); bottom.append(gain);
      } else { bottom.append(el('span', 'te-head-name', t.kind === 'caption' ? 'CAPTIONS' : 'VIDEO')); }
      head.append(top, bottom);
      const resize = el('div', 'te-track-resize'); resize.title = '트랙 높이 조절'; head.append(resize);
      resize.onpointerdown = e => { e.preventDefault(); const start = e.clientY; let height = t.height; this.drag(e, move => { height = clamp(t.height + move.clientY - start, 36, 180); row.style.setProperty('--row-height', height + 'px'); }, () => this.edit({ action: 'track', trackId: t.id, patch: { height: Math.round(height) } }), () => row.style.setProperty('--row-height', t.height + 'px')); };
      const lane = el('div', 'te-lane'); lane.dataset.track = t.id; const items = this.seq.items.filter(c => c.trackId === t.id);
      if (!items.length) lane.append(el('span', 'te-empty-track', t.locked ? '잠긴 트랙' : t.kind === 'audio' ? '오디오 · 가져오기 / 녹음' : t.kind === 'caption' ? 'T → 미리보기를 클릭해 자막 추가' : '클립을 옮기거나 미디어 가져오기'));
      for (const c of items) lane.append(this.renderClip(c, t)); lane.onpointerdown = e => { if (!e.target.closest('.te-clip')) this.blankPointer(e, t); }; row.append(head, lane); this.sheet.append(row);
    }
    renderClip(c, t) {
      const n = el('div', 'te-clip ' + c.kind + (t.locked ? ' locked' : '') + (this.selected().some(x => x.id === c.id) ? ' selected' : '')); n.dataset.id = c.id; n.tabIndex = 0; n.setAttribute('role', 'button'); n.setAttribute('aria-label', (c.name || c.id) + ' ' + M.timecode(c.start, this.seq.fps));
      n.style.left = c.start * this.view.pps + 'px'; n.style.width = Math.max(1, M.length(c) * this.view.pps) + 'px'; n.title = `${c.name || c.id}\n${c.source || c.kind}\n${M.timecode(c.start, this.seq.fps)} — ${M.timecode(M.end(c), this.seq.fps)}\n원본 ${c.in.toFixed(2)} — ${c.out.toFixed(2)}\n${c.reason || ''}`;
      for (const key of ['added', 'trimmed', 'moved']) if (this.diff?.[key]?.some(x => (typeof x === 'string' ? x : x.id) === c.id || (c.linkGroup && (typeof x === 'string' ? x : x.id) === c.linkGroup))) n.classList.add(key);
      const label = el('span', 'te-clip-label'); if (c.linkGroup) label.append(el('span', 'te-clip-link', '↔')); label.append(document.createTextNode(c.kind === 'text' ? c.text || '자막' : c.name || c.id)); n.append(label);
      if (c.kind === 'video' && this.view.thumbs && this.assets[c.source]?.thumbnail) { const thumbs = el('div', 'te-clip-thumbs'); for (let i = 0; i < Math.min(24, Math.ceil(M.length(c) * this.view.pps / 80)); i++) { const img = el('img'); img.src = this.assets[c.source].thumbnail; img.alt = ''; img.draggable = false; thumbs.append(img); } n.append(thumbs); }
      if (c.kind === 'audio') this.audioClip(c, n);else this.opacityClip(c,n,t);
      if (c.effects && ((c.effects.opacity ?? 1) !== 1 || (c.effects.brightness ?? 1) !== 1) || c.automation?.length||c.opacityAutomation?.length) { const fx = el('span', 'te-clip-fx', 'fx'); fx.title = '적용된 효과 / 자동화 · 더블클릭으로 편집'; n.append(fx); }
      for (const edge of ['in', 'out']) { const handle = el('span', 'te-trim ' + (edge === 'in' ? 'left' : 'right')); handle.title = edge === 'in' ? '시작 트림' : '끝 트림'; handle.onpointerdown = e => this.clipPointer(e, c, edge); n.append(handle); }
      n.onpointerdown = e => { if (!e.target.closest('.te-trim,.te-keyframe')) this.clipPointer(e, c); }; n.ondblclick = e => { e.preventDefault(); this.properties(c); }; n.oncontextmenu = e => { e.preventDefault(); this.select([c.id]); this.properties(c); }; n.onkeydown = e => { if (e.key === 'Enter') this.select([c.id]); }; return n;
    }
    audioClip(c, n) {
      if (this.view.waveform) {
        const svg = document.createElementNS(SVG, 'svg'); svg.classList.add('te-waveform'); svg.setAttribute('viewBox', '0 0 1000 40'); svg.setAttribute('preserveAspectRatio', 'none');
        const bins = (this.assets[c.source]?.waveform || []).filter(b => b.end > c.in && b.start < c.out), stride = Math.max(1, Math.floor(bins.length / 200)); let d = '';
        for (let i = 0; i < bins.length; i += stride) { const b = bins[i], x = clamp((b.start - c.in) / M.length(c) * 1000, 0, 1000), height = Math.max(.4, Math.min(19, Math.sqrt(b.power) * 38)); d += `M${x},${20 - height}v${2 * height}`; }
        const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); svg.append(p); n.append(svg);
      }
      const svg = document.createElementNS(SVG, 'svg'); svg.classList.add('te-volume-envelope'); svg.setAttribute('viewBox', '0 0 1000 100'); svg.setAttribute('preserveAspectRatio', 'none');
      const keys = c.automation?.length ? c.automation : [{ time: 0, db: c.gainDb || 0 }, { time: M.length(c), db: c.gainDb || 0 }];
      const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', keys.map((k, i) => `${i ? 'L' : 'M'}${k.time / M.length(c) * 1000},${clamp((12 - k.db) / 72 * 75 + 20, 20, 95)}`).join(' ')); svg.append(path);
      for (const k of c.automation || []) { const point = document.createElementNS(SVG, 'ellipse'); point.classList.add('te-keyframe'); point.setAttribute('cx', k.time / M.length(c) * 1000); point.setAttribute('cy', clamp((12 - k.db) / 72 * 75 + 20, 20, 95)); point.setAttribute('rx',String(4/Math.max(1,M.length(c)*this.view.pps)*1000));point.setAttribute('ry',String(4/Math.max(1,this.seq.tracks.find(t=>t.id===c.trackId).height-8)*100)); point.setAttribute('vector-effect', 'non-scaling-stroke'); point.onpointerdown = e => this.keyframePointer(e, c, k); svg.append(point); }
      n.append(svg);
    }
    opacityClip(c,n,track){
      if(!c.opacityAutomation?.length&&this.view.tool!=='pen')return;const svg=document.createElementNS(SVG,'svg');svg.classList.add('te-volume-envelope');svg.setAttribute('viewBox','0 0 1000 100');svg.setAttribute('preserveAspectRatio','none');const keys=c.opacityAutomation?.length?c.opacityAutomation:[{time:0,value:c.effects?.opacity??1},{time:M.length(c),value:c.effects?.opacity??1}],path=document.createElementNS(SVG,'path');path.setAttribute('d',keys.map((k,i)=>`${i?'L':'M'}${k.time/M.length(c)*1000},${90-k.value*65}`).join(' '));svg.append(path);for(const k of c.opacityAutomation||[]){const p=document.createElementNS(SVG,'ellipse');p.classList.add('te-keyframe');p.setAttribute('cx',k.time/M.length(c)*1000);p.setAttribute('cy',90-k.value*65);p.setAttribute('rx',String(4/Math.max(1,M.length(c)*this.view.pps)*1000));p.setAttribute('ry',String(4/Math.max(1,track.height-8)*100));p.onpointerdown=e=>this.keyframePointer(e,c,k);svg.append(p);}n.append(svg);
    }
    drag(event, move, up, cancel) {
      const pointer = event.pointerId; const target = event.currentTarget; try { target.setPointerCapture(pointer); } catch {}
      const clean = () => { window.removeEventListener('pointermove', moving); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancelled); window.removeEventListener('keydown', escape); this.cancelDrag = null; };
      const moving = e => { if (e.pointerId === pointer) move(e); }, finish = e => { if (e.pointerId === pointer) { clean(); up?.(e); } }, cancelled = () => { clean(); cancel?.(); }, escape = e => { if (e.key === 'Escape') { e.preventDefault(); cancelled(); } };
      window.addEventListener('pointermove', moving); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancelled); window.addEventListener('keydown', escape); this.cancelDrag = cancelled;
    }
    clipPointer(e, c, edge) {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); this.scroll.focus({preventScroll:true});
      if (this.view.tool === 'hand') { this.pan(e); return; }
      if (this.view.tool === 'track') { this.select(this.seq.items.filter(x => x.trackId === c.trackId && x.start >= c.start).map(x => x.id), e.shiftKey); return; }
      if(e.shiftKey||!this.ids.includes(c.id))this.select([c.id], e.shiftKey); if (this.disabled || this.pending || this.seq.tracks.find(t => t.id === c.trackId).locked) { this.status('트랙이 잠겨 있거나 현재 편집할 수 없습니다'); return; }
      if (this.view.tool === 'razor') { this.edit({ action: 'split', ids: [c.id], time: M.frame(this.timeAt(e), this.seq.fps), linked: this.view.linked }); return; }
      if (this.view.tool === 'pen') { const r = e.currentTarget.getBoundingClientRect(); this.edit({ action: 'keyframe', ids: [c.id], linked: false, time: this.timeAt(e),...(c.kind==='audio'?{db:clamp(12 - ((e.clientY - r.top) / r.height - .2) / .75 * 72, -60, 12)}:{property:'opacity',value:clamp((.9-(e.clientY-r.top)/r.height)/.65,0,1)}),remove: e.altKey }); return; }
      const startX = e.clientX,startY=e.clientY, picked = this.selected(), ids = picked.map(x => x.id); let delta = 0, moved = false, trackId = c.trackId;
      const nodes = ids.map(id => [...this.sheet.querySelectorAll('.te-clip')].find(n => n.dataset.id === id)).filter(Boolean);
      this.options.onPause?.(); this.player.pause();
      const cleanup = () => { for (const node of nodes) { node.style.transform = ''; node.style.opacity = ''; node.classList.remove('dragging'); } for (const n of this.sheet.querySelectorAll('.te-drop-target')) n.classList.remove('te-drop-target'); this.snapLine.hidden = true; };
      this.drag(e, move => {
        if (Math.abs(move.clientX - startX)+Math.abs(move.clientY-startY) < 3 && !moved) return; moved = true; delta = M.frame((move.clientX - startX) / this.view.pps, this.seq.fps);
        if (!['slip', 'slide'].includes(this.view.tool)) {
          const point = (edge === 'out' ? M.end(c) : c.start) + delta, snapped = M.snap(this.seq, point, ids, this.head, this.view.pps, this.view.snap && !move.altKey); delta = snapped - (edge === 'out' ? M.end(c) : c.start); this.snapLine.style.left = this.headerWidth() + snapped * this.view.pps + 'px'; this.snapLine.hidden = !this.view.snap;
        }
        if (!edge) { delta = Math.max(-Math.min(...picked.map(x => x.start)), delta); const row = document.elementFromPoint(move.clientX, move.clientY)?.closest('.te-row'); if (row && this.seq.tracks.find(t => t.id === row.dataset.track)?.kind === this.seq.tracks.find(t => t.id === c.trackId).kind) trackId = row.dataset.track; for (const n of this.sheet.querySelectorAll('.te-drop-target')) n.classList.remove('te-drop-target'); const lane = this.sheet.querySelector(`.te-row[data-track="${trackId}"] .te-lane`); lane?.classList.add('te-drop-target'); }
        for (const n of nodes) { n.classList.add('dragging'); n.style.transform = `translateX(${delta * this.view.pps}px)`; }
        this.status(`${edge ? '트림' : this.view.tool === 'slip' ? '슬립' : '이동'} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}s · ${trackId}`);
        if (move.clientX > this.scroll.getBoundingClientRect().right - 20) this.scroll.scrollLeft += 12;
      }, () => { cleanup(); if (!moved || !delta && trackId === c.trackId) { if (c.kind === 'video') this.seek(c.start); return; } this.edit({ action: edge ? (['ripple', 'roll'].includes(this.view.tool) ? this.view.tool : 'trim') : ['slip', 'slide'].includes(this.view.tool) ? this.view.tool : 'move', ids: this.ids, linked: this.view.linked, edge, delta, trackId }); }, cleanup);
    }
    keyframePointer(e, c, key) { e.preventDefault(); e.stopPropagation();const opacity=c.kind!=='audio'; if (e.altKey) { this.edit({ action: 'keyframe', ids: [c.id], linked: false, time: c.start + key.time, remove: true,...(opacity?{property:'opacity'}:{}) }); return; } const r = e.currentTarget.closest('.te-clip').getBoundingClientRect(); let time = c.start + key.time, db = key.db,value=key.value; this.drag(e, move => { time = clamp(this.timeAt(move), c.start, M.end(c)); db = clamp(12 - ((move.clientY - r.top) / r.height - .2) / .75 * 72, -60, 12);value=clamp((.9-(move.clientY-r.top)/r.height)/.65,0,1); this.status(M.timecode(time, this.seq.fps) + ' · ' + (opacity?Math.round(value*100)+'%':db.toFixed(1)+' dB')); }, () => this.edit({ action: 'keyframe', ids: [c.id], linked: false, time, previousTime: key.time,...(opacity?{property:'opacity',value}:{db}) })); }
    pan(e) { const x = e.clientX, y = e.clientY, left = this.scroll.scrollLeft, top = this.scroll.scrollTop; this.drag(e, move => { this.scroll.scrollLeft = left - (move.clientX - x); this.scroll.scrollTop = top - (move.clientY - y); }); }
    blankPointer(e, track) {
      if (e.button !== 0) return; e.preventDefault(); this.scroll.focus({preventScroll:true});
      if (this.view.tool === 'hand') { this.pan(e); return; }
      if (this.view.tool === 'text') { this.newGraphic('text', { x: .5, y: .85 }); return; }
      if (this.view.tool === 'rect') { this.newGraphic('shape', { x: .5, y: .5, width: .3, height: .15 }); return; }
      const startTime = this.timeAt(e), startY = e.clientY, startX = e.clientX; let moved = false; const box = el('div', 'te-marquee'); this.sheet.append(box);
      const rect = this.sheet.getBoundingClientRect(), base = e.shiftKey ? [...this.ids] : [];
      this.drag(e, move => { moved = Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) > 4; const x = Math.min(startX, move.clientX), y = Math.min(startY, move.clientY), w = Math.abs(move.clientX - startX), h = Math.abs(move.clientY - startY); Object.assign(box.style, { left: x - rect.left + 'px', top: y - rect.top + 'px', width: w + 'px', height: h + 'px' }); const ids = [...this.sheet.querySelectorAll('.te-clip')].filter(n => { const r = n.getBoundingClientRect(); return r.left < x + w && r.right > x && r.top < y + h && r.bottom > y; }).map(n => n.dataset.id); this.select([...new Set([...base, ...ids])]); }, () => { box.remove(); if (!moved) { this.select(base); this.seek(startTime); } }, () => box.remove());
    }
    zoom(pps) { const old = this.view.pps, anchorX = this.head * old - this.scroll.scrollLeft, visible = anchorX >= 0 && anchorX <= this.scroll.clientWidth - this.headerWidth(), anchor = visible ? this.head : this.scroll.scrollLeft / old; this.view.pps = clamp(pps, .02, 300); this.render(); this.scroll.scrollLeft = Math.max(0, anchor * this.view.pps - (visible ? anchorX : 0)); this.saveView(); }
    fit() { this.view.pps = Math.max(.02, (this.scroll.clientWidth - this.headerWidth()) / Math.max(5, M.duration(this.seq) + 2)); this.render(); this.scroll.scrollLeft = 0; this.saveView(); }
    navigator() { const n = this.host.querySelector('.te-navigator'); n.max = String(Math.max(0, this.scroll.scrollWidth - this.scroll.clientWidth)); n.value = String(this.scroll.scrollLeft); }
    meter(levels) { const fills = this.host.querySelectorAll('.te-meter-fill'); levels.forEach((db, i) => { fills[i].style.height = clamp((db + 54) / 54 * 100, 0, 100) + '%'; }); const peak = Math.max(...levels); this.host.querySelector('.te-meter-value').textContent = Number.isFinite(peak) ? peak.toFixed(1) : '−∞'; this.host.querySelector('.te-meter').classList.toggle('clipped', peak >= -.2); }
    modal(title, fields, submit, extras = []) {
      this.dialog.replaceChildren(); this.dialog.append(el('h3', '', title)); const form = el('form'); form.method = 'dialog';
      for (const f of fields) { const label = el('label', f.wide ? 'wide' : '', f.label); const input = el(f.type === 'textarea' ? 'textarea' : 'input'); input.name = f.name; input.type = f.type || 'text'; input.value = f.value ?? ''; if (f.min !== undefined) input.min = f.min; if (f.max !== undefined) input.max = f.max; if (f.step !== undefined) input.step = f.step; if (f.required) input.required = true; label.append(input); form.append(label); }
      for (const text of extras) form.append(el('small', '', text)); const actions = el('div', 'te-dialog-actions'); actions.append(button(null, '취소', () => this.dialog.close(), '취소')); const save = button(null, '적용', null, '적용'); save.type = 'submit'; actions.append(save); form.append(actions);
      form.onsubmit = e => { e.preventDefault(); const values = Object.fromEntries(new FormData(form)); try { submit(values); this.dialog.close(); } catch (error) { this.status(error.message); } }; this.dialog.append(form); this.dialog.showModal();
    }
    timeDialog() { this.modal('재생 헤드 이동', [{ name: 'time', label: '시간 (초)', type: 'number', min: 0, step: 1 / this.seq.fps, value: this.head.toFixed(3), wide: true }], v => this.seek(Number(v.time))); }
    markerDialog(marker) { this.modal(marker ? '마커 편집' : '마커 추가', [{ name: 'label', label: '메모', value: marker?.label || '', wide: true }, { name: 'time', label: '시간 (초)', type: 'number', min: 0, step: 1 / this.seq.fps, value: marker?.time ?? this.head }], v => this.edit(marker ? { action: 'marker', id: marker.id, patch: { label: v.label, time: Number(v.time) } } : { action: 'marker', label: v.label, time: Number(v.time) }));if(marker)this.dialog.querySelector('.te-dialog-actions').prepend(button('trash','마커 삭제',()=>{this.edit({action:'marker',id:marker.id,remove:true});this.dialog.close();},'삭제')); }
    properties(c) {
      const fields = [{ name: 'name', label: '클립 이름', value: c.name || c.id, wide: true }];
      if (c.kind === 'audio') fields.push({ name: 'gainDb', label: '기본 게인 (dB)', type: 'number', min: -60, max: 12, step: .5, value: c.gainDb || 0 });
      else { fields.push({ name: 'opacity', label: '불투명도 (0–1)', type: 'number', min: 0, max: 1, step: .05, value: c.effects?.opacity ?? 1 }); if (c.kind === 'video') fields.push({ name: 'brightness', label: '밝기 배율', type: 'number', min: 0, max: 2, step: .05, value: c.effects?.brightness ?? 1 });
        for (const [name, label, value] of [['x', '가로 위치 (0–1)', c.style?.x ?? .5], ['y', '세로 위치 (0–1)', c.style?.y ?? (c.kind === 'text' ? .85 : .5)], ...(c.kind !== 'text' ? [['width', '너비 비율', c.style?.width ?? (c.kind === 'video' ? 1 : .3)], ['height', '높이 비율', c.style?.height ?? (c.kind === 'video' ? 1 : .15)]] : [])]) fields.push({ name, label, type: 'number', min: 0, max: 1, step: .01, value });
      }
      if (c.kind === 'text') fields.push({ name: 'text', label: '자막 내용', type: 'textarea', value: c.text, wide: true }, { name: 'fontSize', label: '글자 크기', type: 'number', min: 12, max: 200, value: c.style?.fontSize || 42 });
      if (['shape', 'text'].includes(c.kind)) fields.push({ name: 'color', label: '색상', type: 'color', value: c.style?.color || (c.kind === 'shape' ? '#70c8ff' : '#ffffff') });
      this.modal('클립 · 효과 설정', fields, v => { const patch = { name: String(v.name) }; if (c.kind === 'audio') patch.gainDb = Number(v.gainDb); else { patch.effects = { opacity: Number(v.opacity), ...(c.kind === 'video' ? { brightness: Number(v.brightness) } : {}) }; patch.style = { ...(c.style || {}), x: Number(v.x), y: Number(v.y), ...(c.kind !== 'text' ? { width: Number(v.width), height: Number(v.height) } : { fontSize: Number(v.fontSize) }), ...(v.color ? { color: v.color } : {}) }; } if (c.kind === 'text') patch.text = v.text; this.edit({ action: 'properties', ids: [c.id], linked: false, patch }); }, [c.source || c.kind, '원본 ' + c.in.toFixed(3) + '–' + c.out.toFixed(3) + '초 · 타임라인 ' + M.timecode(c.start, this.seq.fps)]);
    }
    newGraphic(kind, style) {
      if (this.disabled) return; const start = M.frame(this.head, this.seq.fps), seconds = 3;
      const t = [...this.seq.tracks].sort((a, b) => a.order - b.order).find(t => !t.locked && t.kind === (kind === 'text' ? 'caption' : 'video') && !this.seq.items.some(c => c.trackId === t.id && c.start < start + seconds && M.end(c) > start));
      if (!t) { this.status('삽입 위치에 빈 트랙이 없습니다. 트랙을 추가하거나 재생 헤드를 옮기세요.'); return; }
      this.modal(kind === 'text' ? '자막 추가' : '사각형 추가', [...(kind === 'text' ? [{ name: 'text', label: '자막 내용', type: 'textarea', value: '자막을 입력하세요', wide: true }] : []), { name: 'duration', label: '길이 (초)', type: 'number', min: 1 / this.seq.fps, max: 3600, step: .1, value: seconds }, { name: 'color', label: '색상', type: 'color', value: kind === 'text' ? '#ffffff' : '#70c8ff' }], v => this.edit({ action: 'insert', item: { id: M.uid(kind), kind, trackId: t.id, start, in: 0, out: Number(v.duration), name: kind === 'text' ? '자막' : '사각형', ...(kind === 'text' ? { text: v.text } : {}), style: { ...style, color: v.color, ...(kind === 'text' ? { fontSize: 42 } : {}) } } }));
    }
    settings() {
      const old = this.host.querySelector('.te-popover'); if (old) { old.remove(); return; } const pop = el('div', 'te-popover');
      for (const [key, label] of [['thumbs', '클립 썸네일'], ['waveform', '오디오 파형'], ['follow', '재생 헤드 따라가기']]) { const row = el('label', '', label), box = el('input'); box.type = 'checkbox'; box.checked = this.view[key]; box.onchange = () => { this.view[key] = box.checked; this.render(); this.saveView(); }; row.prepend(box); pop.append(row); }
      pop.append(button(null, '비디오 트랙 추가', () => { pop.remove(); this.edit({ action: 'addTrack', kind: 'video' }); }, '+ 비디오 트랙'), button(null, '오디오 트랙 추가', () => { pop.remove(); this.edit({ action: 'addTrack', kind: 'audio' }); }, '+ 오디오 트랙'), button(null, '시퀀스 이름 / 프레임 레이트', () => { pop.remove(); this.modal('시퀀스 설정', [{ name: 'name', label: '시퀀스 이름', value: this.seq.name, wide: true }, { name: 'fps', label: '프레임 레이트 (정수 fps)', type: 'number', min: 1, max: 120, value: this.seq.fps }], v => this.edit({ action: 'settings', patch: { name: v.name, fps: Number(v.fps) } })); }, '시퀀스 설정'), button(null, '닫기', () => pop.remove(), '닫기')); this.host.append(pop);
    }
    previewTools() {
      const preview = document.querySelector('.preview'); this.overlay = el('div', 'te-preview-tools'); preview.append(this.overlay);
      this.overlay.onpointerdown = e => {
        if (this.disabled || !['rect', 'text'].includes(this.view.tool)) return; e.preventDefault(); const boxRect=preview.getBoundingClientRect(),w=Math.min(boxRect.width,boxRect.height*16/9),h=w*9/16,r={left:boxRect.left+(boxRect.width-w)/2,top:boxRect.top+(boxRect.height-h)/2,width:w,height:h}, x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
        if (this.view.tool === 'text') { this.newGraphic('text', { x, y }); return; }
        const box = el('div', 'te-draw-box'); this.overlay.append(box); let nx = x, ny = y;
        this.drag(e, move => { nx = clamp((move.clientX - r.left) / r.width, 0, 1); ny = clamp((move.clientY - r.top) / r.height, 0, 1); Object.assign(box.style, { left: r.left-boxRect.left+Math.min(x, nx)*r.width+'px', top: r.top-boxRect.top+Math.min(y, ny)*r.height+'px', width: Math.abs(nx - x)*r.width+'px', height: Math.abs(ny - y)*r.height+'px' }); }, () => { box.remove(); if (Math.abs(nx - x) > .01 && Math.abs(ny - y) > .01) this.newGraphic('shape', { x: (x + nx) / 2, y: (y + ny) / 2, width: Math.abs(nx - x), height: Math.abs(ny - y) }); }, () => box.remove());
      };
      this.overlay.classList.toggle('drawing', ['rect', 'text'].includes(this.view.tool));
    }
    importMedia() { if (!this.disabled && !this.pending) { this.pending = true; this.updateControls(); this.options.onImport(this.head); } }
    async record(track, button) {
      if (this.recording) { this.recording.recorder.stop(); return; }
      if (this.disabled || this.pending || track.locked) { this.status('녹음할 트랙의 잠금을 해제하세요'); return; }
      try {
        if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('현재 VS Code에서 마이크를 사용할 수 없습니다. 녹음한 오디오를 가져오기 버튼으로 추가하세요.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), chunks = [], recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
        const time = this.head; this.recording = { recorder, trackId: track.id }; button.classList.add('te-recording'); this.status('녹음 중 · 마이크 버튼을 다시 눌러 저장');
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = async () => { stream.getTracks().forEach(t => t.stop()); this.recording = null; button.classList.remove('te-recording'); const blob = new Blob(chunks, { type: recorder.mimeType }); if (blob.size > 50_000_000) { this.status('녹음은 50MB 이하만 저장할 수 있습니다'); return; } const reader = new FileReader(); reader.onload = () => { this.pending = true; this.updateControls(); this.options.onRecord(String(reader.result).split(',')[1], track.id, time); }; reader.readAsDataURL(blob); };
        recorder.start(500);
      } catch (e) { this.status('마이크: ' + e.message); this.options.onStatus?.('마이크: ' + e.message); }
    }
    keyboard() {
      document.addEventListener('keydown', e => {
        if (e.isComposing || e.target.closest('input,textarea,select,[contenteditable="true"]') || this.dialog.open) return;
        const key = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && key === 'z') { e.preventDefault(); if (!(this.disabled || this.pending)) this.options.onHistory(e.shiftKey ? 'redo' : 'undo'); return; }
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === 'Space') { e.preventDefault(); this.options.onTogglePlay(); }
        else if (key === 'delete' || key === 'backspace') { e.preventDefault(); this.editSelected('delete', { ripple: e.shiftKey }); }
        else if (key === 's') { e.preventDefault(); this.editSelected('split'); }
        else if (key === 'm') this.markerDialog();
        else if (key === '+' || key === '=') this.zoom(this.view.pps * 1.5);
        else if (key === '-') this.zoom(this.view.pps / 1.5);
        else if (key === '\\') this.fit();
        else if (['arrowleft', 'arrowright', 'home', 'end'].includes(key)) { e.preventDefault(); this.seek(key === 'home' ? 0 : key === 'end' ? M.duration(this.seq) : this.head + (key === 'arrowright' ? 1 : -1) * (e.shiftKey ? 10 : 1) / this.seq.fps); }
        else if (key === 'escape') { this.cancelDrag?.(); this.select([]); this.host.querySelector('.te-popover')?.remove(); }
        else { const tools = { v: 'select', a: 'track', b: 'ripple', n: 'roll', c: 'razor', y: 'slip', u: 'slide', p: 'pen', r: 'rect', h: 'hand', t: 'text' }; if (tools[key]) this.setTool(tools[key]); }
      });
    }
    snapshot() { return { head: this.head, fps: this.seq.fps, selected: this.ids, view: this.view, disabled:this.disabled,pending:this.pending,status:this.host.querySelector('.te-status').textContent,duration: M.duration(this.seq), tracks: this.seq.tracks, items: this.seq.items, markers: this.seq.markers, advanced: this.advanced, scrollLeft: this.scroll.scrollLeft, scrollTop: this.scroll.scrollTop, pps: this.view.pps, player: this.player.snapshot(), geometry: [...this.sheet.querySelectorAll('.te-row')].map(row => ({ trackId: row.dataset.track, header: row.querySelector('.te-head').getBoundingClientRect().toJSON(), lane: row.querySelector('.te-lane').getBoundingClientRect().toJSON() })) }; }
  }
  window.CutlineTimeline = TimelineEditor;
})();
