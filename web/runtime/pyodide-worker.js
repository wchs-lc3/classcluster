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

/* --------------------------------- debug --------------------------------- */
// Debugging is a normal run with a trace hook attached. When the hook decides
// to stop, it posts where the program is to the gateway and blocks on that same
// request until the editor answers with a step or a continue. It has to be a
// synchronous request for the same reason input() is one: this thread is inside
// the student's program and cannot come back to an event loop to receive a
// message.

// Post one event, block, return the editor's next command (as JSON text).
// Python calls this; a failure reads as "stop", which unwinds the program.
self.lc3DebugAsk = function (payload) {
  if (!currentRunId) return '{"cmd":"stop"}';
  const x = new XMLHttpRequest();
  x.open('POST', '/api/run/debug/pause?run=' + encodeURIComponent(currentRunId), false);
  x.setRequestHeader('Content-Type', 'application/json');
  try { x.send(payload); } catch (e) { return '{"cmd":"stop"}'; }
  if (x.status !== 200 || !x.responseText) return '{"cmd":"stop"}';
  return x.responseText;
};

const PY_DEBUGGER = `
import json, sys, types

class _Lc3Stop(Exception):
    pass

class _Lc3Debugger:
    # Values are shown as one line of repr, with containers opened two levels
    # down. Deeper than that is a data structure the student should print, not
    # a variable they are watching.
    MAX_ITEMS = 50
    MAX_DEPTH = 2

    def __init__(self, breakpoints, ask):
        self.ask = ask
        self.set_breakpoints(breakpoints)
        self.mode = 'run'
        self.stop_depth = 0
        self.frames = {}

    def set_breakpoints(self, mapping):
        # Keys arrive relative to the program's folder; the copy runs in /proj.
        self.bps = {}
        for rel, lines in (mapping or {}).items():
            self.bps['/proj/' + rel.lstrip('/')] = set(lines or ())

    # ---- values ----

    def repr_of(self, value):
        try:
            text = repr(value)
        except Exception:
            text = '<unreadable>'
        return text if len(text) <= 200 else text[:197] + '...'

    def children(self, value, depth):
        if depth >= self.MAX_DEPTH:
            return []
        out = []
        if isinstance(value, dict):
            for k, v in list(value.items())[:self.MAX_ITEMS]:
                out.append(self.variable(str(k), v, depth + 1))
        elif isinstance(value, (list, tuple, set, frozenset)):
            for i, v in enumerate(list(value)[:self.MAX_ITEMS]):
                out.append(self.variable('[' + str(i) + ']', v, depth + 1))
        elif hasattr(value, '__dict__') and not isinstance(value, type):
            for k, v in list(vars(value).items())[:self.MAX_ITEMS]:
                if not k.startswith('_'):
                    out.append(self.variable(k, v, depth + 1))
        return out

    def variable(self, name, value, depth=0):
        return {
            'name': name,
            'value': self.repr_of(value),
            'type': type(value).__name__,
            'children': self.children(value, depth),
        }

    def scope(self, mapping, is_globals):
        out = []
        for name, value in list(mapping.items())[:200]:
            if name.startswith('__') and name.endswith('__'):
                continue
            if is_globals and isinstance(value, types.ModuleType):
                continue
            out.append(self.variable(name, value))
        return out

    # ---- stopping ----

    def depth(self, frame):
        n = 0
        while frame is not None:
            n += 1
            frame = frame.f_back
        return n

    def state(self, frame, reason):
        frames = []
        self.frames = {}
        fid = 1
        f = frame
        while f is not None and f.f_code.co_filename.startswith('/proj/'):
            frames.append({
                'id': fid,
                'name': f.f_code.co_name if f.f_code.co_name != '<module>' else 'module',
                'line': f.f_lineno,
                'path': f.f_code.co_filename[len('/proj/'):],
                'locals': self.scope(f.f_locals, False),
                'globals': self.scope(f.f_globals, True),
            })
            self.frames[fid] = f
            fid += 1
            f = f.f_back
        return {'t': 'stopped', 'reason': reason, 'frames': frames}

    def evaluate(self, expression, frame_id):
        frame = self.frames.get(frame_id) or self.frames.get(1)
        if frame is None:
            return None
        try:
            value = eval(expression, frame.f_globals, frame.f_locals)
        except Exception as exc:
            return {'name': expression, 'value': type(exc).__name__ + ': ' + str(exc),
                    'type': 'error', 'children': []}
        return self.variable(expression, value)

    def pause(self, frame, reason):
        message = self.state(frame, reason)
        while True:
            try:
                command = json.loads(self.ask(json.dumps(message) if message else ''))
            except Exception:
                raise _Lc3Stop()
            what = command.get('cmd')
            if what == 'wait':
                # Nobody has pressed anything yet. Ask again with nothing to
                # say, so the request never sits long enough to be timed out
                # somewhere between here and the gateway.
                message = None
                continue
            if what == 'evaluate':
                message = {'t': 'eval', 'reqId': command.get('reqId'),
                           'value': self.evaluate(command.get('expression') or '',
                                                  command.get('frameId'))}
                continue
            if what == 'breakpoints':
                self.set_breakpoints(command.get('breakpoints'))
                message = {'t': 'ack'}
                continue
            if what == 'stop':
                raise _Lc3Stop()
            if what == 'next':
                self.mode, self.stop_depth = 'next', self.depth(frame)
            elif what == 'stepIn':
                self.mode = 'stepIn'
            elif what == 'stepOut':
                self.mode, self.stop_depth = 'stepOut', self.depth(frame)
            else:
                self.mode = 'run'
            return

    def trace(self, frame, event, arg):
        # Only the student's own files are worth stepping through; the standard
        # library and Pyodide's own machinery are not what is being debugged.
        if not frame.f_code.co_filename.startswith('/proj/'):
            return None
        if event != 'line':
            return self.trace
        reason = None
        if frame.f_lineno in self.bps.get(frame.f_code.co_filename, ()):
            reason = 'breakpoint'
        elif self.mode == 'stepIn':
            reason = 'step'
        elif self.mode == 'next' and self.depth(frame) <= self.stop_depth:
            reason = 'step'
        elif self.mode == 'stepOut' and self.depth(frame) < self.stop_depth:
            reason = 'step'
        if reason:
            self.pause(frame, reason)
        return self.trace

def _lc3_debug(entry, breakpoints_json, ask):
    import runpy
    debugger = _Lc3Debugger(json.loads(breakpoints_json), ask)
    for name in list(sys.modules):
        path = getattr(sys.modules.get(name), '__file__', '') or ''
        if path.startswith('/proj/'):
            del sys.modules[name]
    if '/proj' not in sys.path:
        sys.path.insert(0, '/proj')
    sys.argv = [entry]
    sys.settrace(debugger.trace)
    try:
        runpy.run_path('/proj/' + entry, run_name='__main__')
    except _Lc3Stop:
        return 'stopped'
    finally:
        sys.settrace(None)
    return 'finished'
`;

async function debugPython(runId, path, breakpoints) {
  await ensurePyodide();
  status(runId, 'starting Python');
  const bundle = await fetchBundle(path);
  resetProj();
  writeProj(bundle.files);
  const entry = bundle.entry || 'main.py';
  const dec = new TextDecoder();
  pyodide.setStdout({ write: (buf) => { out(runId, 'stdout', dec.decode(buf)); return buf.length; } });
  pyodide.setStderr({ write: (buf) => { out(runId, 'stderr', dec.decode(buf)); return buf.length; } });
  pyodide.setStdin({ stdin: pyStdin, autoEOF: true });
  currentRunId = runId;
  status(runId, 'debugging');
  let diags = [];
  let stopped = false;
  try {
    pyodide.runPython(PY_DEBUGGER);
    const run = pyodide.globals.get('_lc3_debug');
    stopped = run(entry, JSON.stringify(breakpoints || {}), self.lc3DebugAsk) === 'stopped';
  } catch (e) {
    const msg = String((e && e.message) || e);
    out(runId, 'stderr', cleanTraceback(msg) + '\n');
    diags = parseTraceback(msg, entry);
  } finally {
    currentRunId = null;
  }
  if (stopped) status(runId, 'stopped by the debugger');
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
    else if (m.cmd === 'debug') await debugPython(m.runId, m.path, m.breakpoints);
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
