/* Shared, DOM-free sequence model. Loaded by the webview and the extension. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CutlineSequence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = value => structuredClone(value);
  const uid = prefix => prefix + '-' + globalThis.crypto.randomUUID();
  const audioId = id => { let hash = 2166136261; for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619); return 'audio-' + id.slice(0,58) + '-' + (hash >>> 0).toString(16); };
  const end = item => item.start + item.out - item.in;
  const length = item => item.out - item.in;
  const duration = seq => Math.max(0, ...seq.items.map(end));
  const frame = (n, fps = 30) => Math.round(n * fps) / fps;
  const timecode = (n, fps = 30) => {
    const frames = Math.max(0, Math.floor(n * fps + 1e-4));
    return [Math.floor(frames / fps / 3600), Math.floor(frames / fps / 60) % 60, Math.floor(frames / fps) % 60, frames % fps].map(x => String(x).padStart(2, '0')).join(':');
  };
  const defaults = () => [
    { id: 'CC', name: 'CC', kind: 'caption', order: 0, height: 44, visible: true },
    ...[3, 2, 1].map((n, i) => ({ id: 'V' + n, name: 'V' + n, kind: 'video', order: i + 1, height: 64, visible: true })),
    ...[1, 2, 3].map((n, i) => ({ id: 'A' + n, name: 'A' + n, kind: 'audio', order: i + 4, height: 56, muted: false, solo: false, gainDb: 0 }))
  ].map(t => ({ ...t, locked: false, targeted: t.id === 'V1' || t.id === 'A1', sourceTarget: t.id === 'V1' || t.id === 'A1' }));
  function fromTimeline(t) {
    const signature = JSON.stringify(t.clips);
    if (t.sequence && t.sequence.legacy === signature) return copy(t.sequence);
    const previous = t.sequence;
    const seq = previous ? copy(previous) : { version: 1, name: 'Sequence 01', fps: 30, mixDb: 0, tracks: defaults(), items: [], markers: [] };
    const old = seq.items;
    const videoIds = new Set(old.filter(c => c.kind === 'video').map(c => c.id));
    seq.items = old.filter(c => c.kind !== 'video' && !(c.kind === 'audio' && videoIds.has(c.linkGroup)));
    let start = 0;
    for (const c of t.clips) {
      const before = old.find(x => x.id === c.id && x.kind === 'video');
      const item = { ...(before || {}), id: c.id, kind: 'video', trackId: before?.trackId || 'V1', start, in: c.in, out: c.out, source: c.source, name: before?.name || c.source.split('/').pop(), reason: c.reason || '', linkGroup: c.id };
      seq.items.push(item);
      const audio = old.find(x => x.kind === 'audio' && x.linkGroup === c.id);
      seq.items.push({ ...(audio || {}), id: audio?.id || audioId(c.id), kind: 'audio', trackId: audio?.trackId || 'A1', start, in: c.in, out: c.out, source: c.source, name: item.name, linkGroup: c.id, gainDb: audio?.gainDb || 0, automation: audio?.automation || [] });
      start += c.out - c.in;
    }
    seq.legacy = signature;
    return validate(seq);
  }
  function toTimeline(t, seq) {
    seq = validate(copy(seq));
    const clips = seq.items.filter(c => c.kind === 'video').sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)).map(c => ({ id: c.id, source: c.source, in: c.in, out: c.out, ...(c.reason ? { reason: c.reason } : {}) }));
    seq.legacy = JSON.stringify(clips);
    return { ...copy(t), clips, sequence: seq };
  }
  function validSource(s) {
    return typeof s === 'string' && s.startsWith('sources/') && !/[\\:\x00-\x1f]/.test(s) && !s.split('/').some(p => !p || p === '.' || p === '..');
  }
  function validate(s) {
    const fail = message => { throw Error(message); };
    const number = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
    if (!s || s.version !== 1 || !Array.isArray(s.tracks) || !Array.isArray(s.items) || !Array.isArray(s.markers)) fail('Invalid sequence document');
    if (!number(s.fps, 1, 120) || !Number.isInteger(s.fps) || !number(s.mixDb, -60, 12) || typeof s.name !== 'string' || s.name.length > 200) fail('Invalid sequence settings');
    if (s.tracks.length > 32 || s.items.length > 2000 || s.markers.length > 1000) fail('Sequence is too large');
    const ids = new Set(), trackIds = new Set();
    for (const t of s.tracks) {
      if (!t || typeof t.id !== 'string' || !/^[\w-]{1,80}$/.test(t.id) || trackIds.has(t.id) || !['video', 'audio', 'caption'].includes(t.kind) || !number(t.height, 36, 180) || !number(t.order, 0, 1000) || typeof t.name !== 'string' || t.name.length > 80) fail('Invalid or duplicate track');
      for (const key of ['locked', 'visible', 'muted', 'solo', 'targeted', 'sourceTarget']) if (t[key] !== undefined && typeof t[key] !== 'boolean') fail('Invalid track switch');
      if (t.gainDb !== undefined && !number(t.gainDb, -60, 12)) fail('Invalid track gain');
      trackIds.add(t.id);
    }
    for (const c of s.items) {
      if (!c || typeof c.id !== 'string' || !/^[\w-]{1,80}$/.test(c.id) || ids.has(c.id) || !['video', 'audio', 'text', 'shape'].includes(c.kind) || !trackIds.has(c.trackId)) fail('Invalid or duplicate sequence clip');
      ids.add(c.id);
      if (!number(c.start, 0, 604800) || !number(c.in, 0, 604800) || !number(c.out, c.in + 1e-6, 604800)) fail('Invalid clip range');
      const track = s.tracks.find(t => t.id === c.trackId);
      if (track.kind === 'audio' ? c.kind !== 'audio' : track.kind === 'caption' ? c.kind !== 'text' : c.kind === 'audio') fail('Clip and track types do not match');
      if (['video', 'audio'].includes(c.kind) && !validSource(c.source)) fail('Clip source must stay below sources/');
      if (c.name !== undefined && (typeof c.name !== 'string' || c.name.length > 300)) fail('Invalid clip name');
      if (c.reason !== undefined && (typeof c.reason !== 'string' || c.reason.length > 1000)) fail('Invalid clip reason');
      if (c.linkGroup !== undefined && (typeof c.linkGroup !== 'string' || !/^[\w-]{1,80}$/.test(c.linkGroup))) fail('Invalid link group');
      if (c.gainDb !== undefined && !number(c.gainDb, -60, 12)) fail('Invalid clip gain');
      if (c.automation !== undefined) {
        if (!Array.isArray(c.automation) || c.automation.length > 200) fail('Invalid volume keyframes');
        let last = -1;
        for (const k of c.automation) { if (!number(k.time, 0, length(c) + 1e-6) || k.time <= last || !number(k.db, -60, 12)) fail('Invalid volume keyframe'); last = k.time; }
      }
      if(c.opacityAutomation!==undefined){if(!Array.isArray(c.opacityAutomation)||c.opacityAutomation.length>200)fail('Invalid opacity keyframes');let last=-1;for(const k of c.opacityAutomation){if(!number(k.time,0,length(c)+1e-6)||k.time<=last||!number(k.value,0,1))fail('Invalid opacity keyframe');last=k.time;}}
      if (c.kind === 'text' && (typeof c.text !== 'string' || c.text.length > 2000)) fail('Invalid caption text');
      if (c.style !== undefined) {
        if (!c.style || typeof c.style !== 'object') fail('Invalid clip style');
        for (const key of ['x', 'y', 'width', 'height', 'opacity']) if (c.style[key] !== undefined && !number(c.style[key], 0, 1)) fail('Invalid visual placement');
        if (c.style.fontSize !== undefined && !number(c.style.fontSize, 12, 200)) fail('Invalid font size');
        if (c.style.color !== undefined && !/^#[0-9a-f]{6}$/i.test(c.style.color)) fail('Invalid clip color');
      }
      if (c.effects !== undefined && (!c.effects || !number(c.effects.opacity ?? 1, 0, 1) || !number(c.effects.brightness ?? 1, 0, 2))) fail('Invalid effects');
    }
    for (const t of s.tracks) {
      const row = s.items.filter(c => c.trackId === t.id).sort((a, b) => a.start - b.start);
      for (let i = 1; i < row.length; i++) if (row[i].start < end(row[i - 1]) - 1e-6) fail('같은 트랙의 클립은 겹칠 수 없습니다. 빈 공간이나 다른 트랙으로 옮기세요.');
    }
    const markerIds = new Set();
    for (const m of s.markers) {
      if (!m || typeof m.id !== 'string' || !/^[\w-]{1,80}$/.test(m.id) || markerIds.has(m.id) || !number(m.time, 0, 604800) || typeof m.label !== 'string' || m.label.length > 300) fail('Invalid marker');
      markerIds.add(m.id);
    }
    return s;
  }
  function assertLocks(before, after) {
    for (const track of before.tracks.filter(t => t.locked)) {
      const a = before.items.filter(c => c.trackId === track.id), b = after.items.filter(c => c.trackId === track.id);
      if (JSON.stringify(a) !== JSON.stringify(b) || !after.tracks.some(t => t.id === track.id)) throw Error(track.name + ' 트랙이 잠겨 있습니다. 먼저 잠금을 해제하세요.');
    }
  }
  function selected(seq, ids, linked = true) {
    const chosen = seq.items.filter(c => ids.includes(c.id));
    const groups = new Set(linked ? chosen.map(c => c.linkGroup).filter(Boolean) : []);
    return seq.items.filter(c => ids.includes(c.id) || (c.linkGroup && groups.has(c.linkGroup)));
  }
  function snap(seq, time, exclude, head, pixelsPerSecond, enabled = true) {
    if (!enabled) return frame(Math.max(0, time), seq.fps);
    const points = [0, head, ...seq.markers.map(m => m.time), ...seq.items.filter(c => !exclude.includes(c.id)).flatMap(c => [c.start, end(c)])].filter(Number.isFinite);
    const target = points.sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0];
    return Math.abs(target - time) <= 9 / pixelsPerSecond ? target : frame(Math.max(0, time), seq.fps);
  }
  function volumeAt(c, time) {
    const keys = c.automation || [];
    if (!keys.length) return c.gainDb || 0;
    if (time <= keys[0].time) return keys[0].db;
    for (let i = 1; i < keys.length; i++) if (time <= keys[i].time) {
      const a = keys[i - 1], b = keys[i];
      return a.db + (b.db - a.db) * ((time - a.time) / (b.time - a.time));
    }
    return keys[keys.length - 1].db;
  }
  const audible = (seq, track) => !track.muted && (!seq.tracks.some(t => t.kind === 'audio' && t.solo && !t.muted) || !!track.solo);
  function opacityAt(c,time){const keys=c.opacityAutomation||[];if(!keys.length)return c.effects?.opacity??1;if(time<=keys[0].time)return keys[0].value;for(let i=1;i<keys.length;i++)if(time<=keys[i].time){const a=keys[i-1],b=keys[i];return a.value+(b.value-a.value)*(time-a.time)/(b.time-a.time);}return keys[keys.length-1].value;}
  function trimAutomation(c,before){
    const shift=c.in-before.in,d=length(c);
    for(const [key,value,read] of [['automation','db',volumeAt],['opacityAutomation','value',opacityAt]])if(before[key]?.length)c[key]=[{time:0,[value]:read(before,shift)},...before[key].map(k=>({...k,time:k.time-shift})).filter(k=>k.time>1e-6&&k.time<d-1e-6),{time:d,[value]:read(before,shift+d)}];
  }
  function operate(original, op) {
    const s = copy(original), picked = selected(s, op.ids || [], op.linked !== false), set = new Set(picked.map(c => c.id));
    const track = id => s.tracks.find(t => t.id === id);
    const fps = s.fps;
    const finish = () => { assertLocks(original, s); validate(s); return s; };
    if (op.action === 'track') { const t = track(op.trackId); if (!t) throw Error('트랙을 찾을 수 없습니다');if(op.patch?.sourceTarget===true)for(const other of s.tracks.filter(x=>x.kind===t.kind))other.sourceTarget=false; Object.assign(t, op.patch); return finish(); }
    if (op.action === 'addTrack') {
      const kind = op.kind === 'audio' ? 'audio' : 'video', prefix = kind === 'audio' ? 'A' : 'V';
      let n = 1; while (track(prefix + n)) n++;
      const order = kind === 'video' ? Math.min(...s.tracks.filter(t => t.kind === 'video').map(t => t.order)) - .5 : Math.max(...s.tracks.map(t => t.order)) + 1;
      s.tracks.push({ id: prefix + n, name: prefix + n, kind, order: Math.max(0, order), height: 64, locked: false, visible: true, muted: false, solo: false, gainDb: 0, targeted: true });
      s.tracks.sort((a, b) => a.order - b.order).forEach((t, i) => t.order = i);
      return finish();
    }
    if (op.action === 'settings') { Object.assign(s, op.patch); return finish(); }
    if (op.action === 'marker') {
      if (op.remove) s.markers = s.markers.filter(m => m.id !== op.id);
      else if (op.id) { const marker = s.markers.find(m => m.id === op.id); if (!marker) throw Error('마커 없음'); Object.assign(marker, op.patch); }
      else s.markers.push({ id: uid('marker'), time: frame(op.time, fps), label: op.label || '마커' });
      return finish();
    }
    if (op.action === 'insert') { s.items.push(...copy(op.items || [op.item])); return finish(); }
    if (!picked.length) throw Error('클립을 선택하세요');
    if (op.action === 'move') {
      const first = s.items.find(c => c.id === op.ids[0]);
      const sourceTrack = track(first.trackId), target = track(op.trackId || first.trackId);
      if (!target || target.kind !== sourceTrack.kind) throw Error('같은 종류의 트랙으로 옮기세요');
      const delta = Math.max(-Math.min(...picked.map(c => c.start)), frame(op.delta, fps));
      for (const c of picked) { c.start = frame(c.start + delta, fps); if (c.trackId === sourceTrack.id) c.trackId = target.id; }
    } else if (op.action === 'delete') {
      s.items = s.items.filter(c => !set.has(c.id));
      if (op.ripple) for (const t of s.tracks) {
        const removed = picked.filter(c => c.trackId === t.id);
        for (const c of s.items.filter(c => c.trackId === t.id)) c.start -= removed.filter(r => end(r) <= c.start + 1e-6).reduce((n, r) => n + length(r), 0);
      }
    } else if (op.action === 'split') {
      let cuts = 0; const rightGroups = new Map();
      for (const c of picked) {
        const at = frame(op.time, fps), delta = at - c.start;
        if (delta <= 1e-6 || delta >= length(c) - 1e-6) continue;
        const right = { ...copy(c), id: uid('split'), start: at, in: c.in + delta };
        if (c.automation?.length) {
          right.automation = [{ time: 0, db: volumeAt(c, delta) }, ...c.automation.filter(k => k.time > delta).map(k => ({ ...k, time: k.time - delta }))];
          c.automation = [...c.automation.filter(k => k.time < delta), { time: delta, db: volumeAt(c, delta) }];
        }
        if(c.opacityAutomation?.length){right.opacityAutomation=[{time:0,value:opacityAt(c,delta)},...c.opacityAutomation.filter(k=>k.time>delta).map(k=>({...k,time:k.time-delta}))];c.opacityAutomation=[...c.opacityAutomation.filter(k=>k.time<delta),{time:delta,value:opacityAt(c,delta)}];}
        c.out = c.in + delta;
        if (c.linkGroup) { if (!rightGroups.has(c.linkGroup)) rightGroups.set(c.linkGroup, uid('split')); right.linkGroup = rightGroups.get(c.linkGroup); if(c.kind==='video')right.id=right.linkGroup; }
        s.items.push(right); cuts++;
      }
      if (!cuts) throw Error('클립 내부에 재생 헤드를 놓으세요');
    } else if (['trim', 'ripple', 'roll'].includes(op.action)) {
      const delta = frame(op.delta, fps);
      for (const c of picked) {
        const before=copy(c),oldEnd = end(c), oldStart = c.start, oldLength = length(c);
        const neighbor = s.items.find(x => x.trackId === c.trackId && !set.has(x.id) && Math.abs((op.edge === 'out' ? x.start - oldEnd : end(x) - oldStart)) < 1e-6);
        if (op.action === 'roll' && !neighbor) throw Error('롤 편집은 맞닿은 두 클립 사이에서 사용하세요');
        if (op.edge === 'in') { c.in += delta; c.start += delta; }
        else c.out += delta;
        trimAutomation(c,before);
        if (op.action === 'roll') { const oldNeighbor=copy(neighbor);if (op.edge === 'out') { neighbor.start += delta; neighbor.in += delta; } else neighbor.out += delta;trimAutomation(neighbor,oldNeighbor); }
        if (op.action === 'ripple') {
          const shift = length(c) - oldLength;
          if (op.edge === 'in') c.start = oldStart;
          for (const x of s.items) if (x.trackId === c.trackId && !set.has(x.id) && x.start >= oldEnd - 1e-6) x.start += shift;
        }
      }
    } else if (op.action === 'slip') {
      const delta = frame(op.delta, fps); for (const c of picked) { c.in += delta; c.out += delta; }
    } else if (op.action === 'slide') {
      const delta = frame(op.delta, fps);
      for (const c of picked) {
        const previous = s.items.find(x => x.trackId === c.trackId && !set.has(x.id) && Math.abs(end(x) - c.start) < 1e-6);
        const next = s.items.find(x => x.trackId === c.trackId && !set.has(x.id) && Math.abs(x.start - end(c)) < 1e-6);
        if (!previous || !next) throw Error('슬라이드는 양옆에 맞닿은 클립이 있어야 합니다');
        const oldPrevious=copy(previous),oldNext=copy(next);previous.out += delta; next.in += delta; next.start += delta; c.start += delta;trimAutomation(previous,oldPrevious);trimAutomation(next,oldNext);
      }
    } else if (op.action === 'properties') {
      for (const c of picked.filter(c => op.ids.includes(c.id))) {if(op.patch.gainDb!==undefined&&c.automation?.length)c.automation=c.automation.map(k=>({...k,db:Math.max(-60,Math.min(12,k.db+op.patch.gainDb-(c.gainDb||0)))}));if(op.patch.effects?.opacity!==undefined&&c.opacityAutomation?.length){const ratio=op.patch.effects.opacity/(c.effects?.opacity||1);c.opacityAutomation=c.opacityAutomation.map(k=>({...k,value:Math.max(0,Math.min(1,k.value*ratio))}));}Object.assign(c, copy(op.patch));}
    } else if (op.action === 'keyframe') {
      const opacity=op.property==='opacity';
      for (const c of picked.filter(c => opacity?c.kind!=='audio':c.kind === 'audio')) {
        const time = frame(Math.max(0, Math.min(length(c), op.time - c.start)), fps);
        const key=opacity?'opacityAutomation':'automation',keys = (c[key] || []).filter(k => Math.abs(k.time - time) > .5 / fps && (op.previousTime === undefined || Math.abs(k.time - op.previousTime) > .5 / fps));
        if (!op.remove) keys.push({ time, [opacity?'value':'db']: opacity?op.value:op.db });
        c[key] = keys.sort((a, b) => a.time - b.time);
      }
    } else throw Error('Unknown sequence operation');
    return finish();
  }
  return { copy, uid, end, length, duration, frame, timecode, defaults, fromTimeline, toTimeline, validSource, validate, assertLocks, selected, snap, volumeAt, opacityAt, audible, operate };
});
