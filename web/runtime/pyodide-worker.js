/* Pyodide runs here, in a Web Worker, so that a blocking input() or an infinite
 * loop freezes only this worker thread, never the VS Code tab. stdin blocks on a
 * synchronous long-poll to the gateway (allowed in a worker); the terminal feeds
 * lines to that queue. The worker posts stdout/diags/etc back to the iframe,
 * which relays them to the extension over the BroadcastChannel.
 */
'use strict';

let pyodide = null;
let ready = null;
let blackReady = null;
let currentRunId = null;

function ensurePyodide() {
  if (ready) return ready;
  ready = (async () => {
    importScripts('/heavy/pyodide/pyodide.js');
    pyodide = await loadPyodide({ indexURL: '/heavy/pyodide/' });
    pyodide.runPython(`
import json
def _lc3_syntax_check(src):
    try:
        compile(src, '<student>', 'exec')
        return '[]'
    except SyntaxError as e:
        return json.dumps([{ 'line': e.lineno or 1, 'col': e.offset or 1,
                             'message': 'SyntaxError: ' + (e.msg or ''),
                             'severity': 'error' }])
`);
    return pyodide;
  })();
  return ready;
}

function post(m) { postMessage(m); }
function out(runId, stream, data) { post({ t: 'out', runId, stream, data }); }
function status(runId, text) { post({ t: 'status', runId, text }); }

async function fetchBundle(path) {
  const r = await fetch('/api/runbundle?path=' + encodeURIComponent(path), { credentials: 'same-origin' });
  if (!r.ok) throw new Error('cannot load your files (' + r.status + ')');
  return r.json();
}
async function fetchFile(path) {
  const r = await fetch('/api/fs/read?path=' + encodeURIComponent(path), { credentials: 'same-origin' });
  if (!r.ok) throw new Error('cannot read file (' + r.status + ')');
  return r.text();
}
function b64ToBytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

// Blocking read of one line: a synchronous long-poll on this worker thread.
function pyStdin() {
  if (!currentRunId) return null;
  const x = new XMLHttpRequest();
  x.open('GET', '/api/run/stdin?run=' + encodeURIComponent(currentRunId), false);
  try { x.send(null); } catch (e) { return null; }
  return x.status === 200 ? x.responseText : null;
}

const PY_RUNNER = (entry) => `
import sys, runpy
for _m in list(sys.modules):
    _f = getattr(sys.modules.get(_m), '__file__', '') or ''
    if _f.startswith('/proj/'):
        del sys.modules[_m]
if '/proj' not in sys.path:
    sys.path.insert(0, '/proj')
sys.argv = [${JSON.stringify(entry)}]
runpy.run_path('/proj/' + ${JSON.stringify(entry)}, run_name='__main__')
`;

function resetProj() {
  try { pyodide.runPython("import shutil; shutil.rmtree('/proj', ignore_errors=True)"); } catch (e) {}
  try { pyodide.FS.mkdir('/proj'); } catch (e) {}
}
function writeProj(files) {
  for (const [rel, b64] of Object.entries(files)) {
    const parts = rel.split('/');
    let dir = '/proj';
    for (const part of parts.slice(0, -1)) { dir += '/' + part; try { pyodide.FS.mkdir(dir); } catch (e) {} }
    pyodide.FS.writeFile('/proj/' + rel, b64ToBytes(b64));
  }
}
function cleanTraceback(text) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes('/proj/'));
  if (i < 0) return text.replace(/\/proj\//g, '');
  return ('Traceback (most recent call last):\n' + lines.slice(i).join('\n')).replace(/\/proj\//g, '');
}
function parseTraceback(text, entry) {
  const re = new RegExp('File "/proj/' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '", line (\\d+)', 'g');
  let m, last = null;
  while ((m = re.exec(text)) !== null) last = parseInt(m[1], 10);
  const lines = text.trim().split('\n');
  return last ? [{ line: last, col: 1, message: lines[lines.length - 1] || 'error', severity: 'error' }] : [];
}

async function runPython(runId, path) {
  await ensurePyodide();
  status(runId, 'starting Python');
  const bundle = await fetchBundle(path);
  resetProj();
  writeProj(bundle.files);
  const entry = bundle.entry || 'main.py';
  // Flush byte-for-byte (not batched on newline) so a prompt written without a
  // trailing newline - like input('Your name: ') - appears before the read.
  const dec = new TextDecoder();
  pyodide.setStdout({ write: (buf) => { out(runId, 'stdout', dec.decode(buf)); return buf.length; } });
  pyodide.setStderr({ write: (buf) => { out(runId, 'stderr', dec.decode(buf)); return buf.length; } });
  pyodide.setStdin({ stdin: pyStdin, autoEOF: true });
  currentRunId = runId;
  status(runId, 'running');
  let diags = [];
  try {
    await pyodide.runPythonAsync(PY_RUNNER(entry));
  } catch (e) {
    const msg = String((e && e.message) || e);
    out(runId, 'stderr', cleanTraceback(msg) + '\n');
    diags = parseTraceback(msg, entry);
  } finally {
    currentRunId = null;
  }
  post({ t: 'diags', path, diags });
  post({ t: 'exit', runId, code: diags.length ? 1 : 0 });
}

async function checkPython(path) {
  try {
    await ensurePyodide();
    const src = await fetchFile(path);
    const json = pyodide.globals.get('_lc3_syntax_check')(src);
    post({ t: 'diags', path, diags: JSON.parse(json) });
  } catch (e) { /* best-effort */ }
}

function ensureBlack() {
  if (blackReady) return blackReady;
  blackReady = (async () => {
    await ensurePyodide();
    await pyodide.loadPackage('micropip');
    const micropip = pyodide.pyimport('micropip');
    const wheels = await (await fetch('/runtime/pyfmt/wheels.json')).json();
    await micropip.install(wheels.map((wname) => self.location.origin + '/runtime/pyfmt/' + wname));
    pyodide.runPython('import black');
    return true;
  })();
  return blackReady;
}
async function formatPython(reqId, src) {
  let text = src;
  try {
    await ensureBlack();
    pyodide.globals.set('__lc3_src', src);
    text = pyodide.runPython('black.format_str(__lc3_src, mode=black.Mode())');
  } catch (e) { text = src; }
  post({ t: 'formatted', reqId, text });
}

onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.cmd === 'run') await runPython(m.runId, m.path);
    else if (m.cmd === 'check') await checkPython(m.path);
    else if (m.cmd === 'format') await formatPython(m.reqId, m.text);
    else if (m.cmd === 'preload') { await ensurePyodide(); post({ t: 'ready', lang: 'python' }); }
  } catch (err) {
    if (m.runId) {
      out(m.runId, 'stderr', String((err && err.message) || err) + '\n');
      post({ t: 'exit', runId: m.runId, code: 1 });
    }
  }
};
