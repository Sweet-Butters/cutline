// Run against a timeline project and a built Cutline extension.
// node tools/test-playback.js --project PATH --vscode EXECUTABLE [--extension PATH]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {setTimeout: sleep} = require('node:timers/promises');
const {parseArgs} = require('node:util');

// On a cold cache the editor can encode two full-length proxies before canplay.
const proxyTimeout = 2 * 60 * 60 * 1000;

async function until(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(200);
  }
  throw new Error('Timed out waiting for ' + description);
}

// VS Code loads this entry point inside its extension test host.
exports.run = async function run() {
  const vscode = require('vscode');
  const report = {runtime: vscode.version, passed: false, checks: []};
  let api;
  try {
    const project = vscode.workspace.workspaceFolders[0].uri.fsPath;
    let timeline;
    try { timeline = JSON.parse(fs.readFileSync(path.join(project, 'timeline.json'), 'utf8')); }
    catch { throw new Error('Could not read timeline.json'); }
    const clip = timeline.clips?.[0];
    assert.ok(clip && clip.out - clip.in >= 3, 'The first clip must be at least three seconds long');
    report.clip = {in: clip.in, out: clip.out};
    const extension = vscode.extensions.getExtension('cutline-local.cutline');
    assert.ok(extension, 'Cutline extension unavailable');
    assert.ok(path.relative(process.env.CUTLINE_PLAYBACK_EXTENSION, extension.extensionPath) === '',
      'Test host loaded a different Cutline extension');
    api = await extension.activate();
    assert.equal(await api.startup, true, 'Cutline must open the project automatically');
    const ready = await until(() => {
      if (api.events.some(e => e.type === 'error')) throw new Error('Cutline reported a project or proxy error');
      const failed = api.events.filter(e => e.type === 'playback' && e.event === 'error');
      if (failed.length >= 2) throw new Error('The primary and compatibility proxies failed to play');
      return api.events.find(e => e.type === 'playback' && e.event === 'canplay' && e.source === clip.source);
    }, 'first clip canplay', proxyTimeout);
    const metadata = api.events.find(e => e.type === 'playback' &&
      e.event === 'loadedmetadata' && e.revision === ready.revision && e.source === clip.source);
    assert.ok(metadata && metadata.duration >= clip.out - 0.25, 'Loaded media must cover the first clip');
    const applied = api.events.find(e => e.type === 'applied' && e.revision === ready.revision);
    report.media = {format: applied.format, duration: metadata.duration, width: metadata.width, height: metadata.height};

    let serial = 0;
    async function snapshot() {
      const tag = 'playback-check-' + (++serial);
      await api.testAction('snapshot', {tag});
      const event = await until(() => api.events.find(e => e.type === 'snapshot' && e.tag === tag), 'panel snapshot');
      // Snapshot events also contain transcript text. Persist only playback diagnostics.
      const {time, frames, paused, seeking, audioBytes, width, index} = event;
      return {time, frames, paused, seeking, audioBytes, width, index};
    }

    const length = clip.out - clip.in;
    const targets = [clip.in, clip.in + length / 2, clip.out - Math.min(8, length / 3)];
    for (const target of targets) {
      await api.testAction('select', {index: 0, time: target});
      const before = await until(async () => {
        const s = await snapshot();
        return s.index === 0 && s.paused && !s.seeking && Math.abs(s.time - target) < 0.5 && s;
      }, 'seek at ' + target);
      await api.testAction('play', {muted: true});
      const after = await until(async () => {
        const s = await snapshot();
        return s.index === 0 && !s.paused && !s.seeking && s.width > 0 &&
          s.frames > before.frames && s.time >= before.time + 0.6 && s;
      }, 'decoded frames at ' + target);
      await api.testAction('play');
      report.checks.push({target, before, after});
    }
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    if (api) {
      report.playbackErrors = api.events.filter(e => e.type === 'playback' && e.event === 'error').length;
      api.dispose();
    }
    fs.writeFileSync(process.env.CUTLINE_PLAYBACK_RESULT, JSON.stringify(report));
  }
};

function launch() {
  const {values} = parseArgs({options: {
    project: {type: 'string'}, vscode: {type: 'string'}, extension: {type: 'string'}
  }});
  if (!values.project || !values.vscode) {
    throw new Error('Usage: node tools/test-playback.js --project PATH --vscode EXECUTABLE [--extension PATH]');
  }
  const project = path.resolve(values.project);
  const binary = path.resolve(values.vscode);
  const extension = path.resolve(values.extension || path.join(__dirname, '..'));
  fs.accessSync(path.join(project, 'timeline.json'));
  fs.accessSync(path.join(extension, 'out', 'extension.js'));
  fs.accessSync(binary);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cutline-playback-'));
  try {
    const result = path.join(scratch, 'result.json');
    const profile = path.join(scratch, 'user-data');
    const user = path.join(profile, 'User');
    fs.mkdirSync(user, {recursive: true});
    fs.writeFileSync(path.join(user, 'settings.json'), JSON.stringify({
      'telemetry.telemetryLevel': 'off', 'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false, 'update.mode': 'none', 'workbench.startupEditor': 'none'
    }));
    const editor = spawnSync(binary, [
      project, '--user-data-dir', profile, '--extensions-dir', path.join(scratch, 'extensions'),
      '--extensionDevelopmentPath=' + extension, '--extensionTestsPath=' + __filename,
      '--disable-extensions', '--disable-workspace-trust', '--disable-telemetry', '--disable-updates',
      '--skip-welcome', '--skip-release-notes', '--log', 'off'
    ], {
      env: {...process.env, VSCODE_PORTABLE: scratch, CUTLINE_PLAYBACK_RESULT: result, CUTLINE_PLAYBACK_EXTENSION: extension},
      timeout: proxyTimeout + 300000, stdio: 'ignore', windowsHide: true
    });
    if (editor.error) throw editor.error;
    if (!fs.existsSync(result)) throw new Error('Editor exited without a playback report (exit ' + editor.status + ')');
    const report = JSON.parse(fs.readFileSync(result, 'utf8'));
    console.log(JSON.stringify(report, null, 2));
    if (editor.status !== 0 || !report.passed) process.exitCode = 1;
  } finally {
    const target = path.resolve(scratch);
    assert.ok(path.dirname(target) === path.resolve(os.tmpdir()) &&
      /^cutline-playback-[A-Za-z0-9]{6}$/.test(path.basename(target)), 'Unexpected temporary profile path');
    fs.rmSync(target, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}

if (require.main === module) {
  try { launch(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
