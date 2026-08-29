/* LC3 web extension.
 *
 * Provides the student's whole workflow inside the VS Code page:
 *   - a REST-backed file system on the lc3: scheme,
 *   - Run, which executes the open file in a hidden same-origin runtime iframe
 *     and streams its output into an integrated terminal (over a
 *     BroadcastChannel the runtime and this extension share),
 *   - Submit, which grades against the private tests on the cluster,
 *   - editor diagnostics (squiggles + Problems) from syntax and compile errors,
 *   - a teacher-only Class Management panel that talks to the admin API through
 *     this extension (the webview cannot send the session cookie itself).
 */
const vscode = require('vscode');

const ORIGIN = (typeof self !== 'undefined' && self.location) ? self.location.origin : '';
function api(path) { return ORIGIN + path; }

async function req(method, path, body) {
  const opts = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Uint8Array) {
      opts.body = body;
      opts.headers = { 'Content-Type': 'application/octet-stream' };
    } else {
      opts.body = JSON.stringify(body);
      opts.headers = { 'Content-Type': 'application/json' };
    }
  }
  return fetch(api(path), opts);
}

function rid() { return Math.random().toString(36).slice(2, 10); }
function enc(s) { return new TextEncoder().encode(s); }

/* ------------------------------ file system ------------------------------ */

function fsError(status, uri) {
  if (status === 404) return vscode.FileSystemError.FileNotFound(uri);
  if (status === 401) return vscode.FileSystemError.NoPermissions('Not logged in - reload the page');
  return vscode.FileSystemError.Unavailable('LC3 server error ' + status);
}

class Lc3Fs {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeFile = this._emitter.event;
  }
  watch() { return new vscode.Disposable(() => {}); }
  async stat(uri) {
    if (uri.path === '/' || uri.path === '') {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    const resp = await req('GET', '/api/fs/stat?path=' + encodeURIComponent(uri.path));
    if (!resp.ok) throw fsError(resp.status, uri);
    const j = await resp.json();
    return {
      type: j.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: j.mtime, mtime: j.mtime, size: j.size
    };
  }
  async readDirectory(uri) {
    const resp = await req('GET', '/api/fs/list?path=' + encodeURIComponent(uri.path || '/'));
    if (!resp.ok) throw fsError(resp.status, uri);
    const j = await resp.json();
    return j.entries.map(e =>
      [e.name, e.type === 'dir' ? vscode.FileType.Directory : vscode.FileType.File]);
  }
  async readFile(uri) {
    const resp = await req('GET', '/api/fs/read?path=' + encodeURIComponent(uri.path));
    if (!resp.ok) throw fsError(resp.status, uri);
    return new Uint8Array(await resp.arrayBuffer());
  }
  async writeFile(uri, content) {
    const resp = await req('POST', '/api/fs/write?path=' + encodeURIComponent(uri.path), content);
    if (!resp.ok) throw fsError(resp.status, uri);
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }
  async createDirectory(uri) {
    const resp = await req('POST', '/api/fs/mkdir?path=' + encodeURIComponent(uri.path));
    if (!resp.ok) throw fsError(resp.status, uri);
  }
  async delete(uri) {
    const resp = await req('POST', '/api/fs/delete?path=' + encodeURIComponent(uri.path));
    if (!resp.ok) throw fsError(resp.status, uri);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }
  async rename(oldUri, newUri) {
    const resp = await req('POST', '/api/fs/rename?src=' + encodeURIComponent(oldUri.path)
      + '&dst=' + encodeURIComponent(newUri.path));
    if (!resp.ok) throw fsError(resp.status, oldUri);
  }
}

/* ------------------------------- terminal -------------------------------- */
// A Pseudoterminal: pure JS, no backend pty. It renders streamed program
// output and, during a Python run, feeds typed lines to the program's stdin.

class RunTerminal {
  constructor() {
    this.writeEmitter = new vscode.EventEmitter();
    this.onDidWrite = this.writeEmitter.event;
    this.closeEmitter = new vscode.EventEmitter();
    this.onDidClose = this.closeEmitter.event;
    this.line = '';
    this.mode = 'idle';        // idle | run (python) | exec (cluster JVM)
    this.runId = null;         // python run id for the stdin relay
    this.execRun = null;       // cluster run id for interactive input
    // A pseudoterminal only starts receiving onDidWrite once the workbench has
    // opened it, which happens a tick or two after createTerminal. The first
    // Run writes its header before that, so hold output until open().
    this.opened = false;
    this.pending = [];
  }
  open() {
    this.opened = true;
    // The hint is only useful when nothing is waiting to be shown; on the first
    // Run the student wants their program's output, not instructions.
    if (!this.pending.length) {
      this.raw('\x1b[2mLC3 terminal. Open a file and press Run (F5).\x1b[0m\r\n');
      return;
    }
    const queued = this.pending;
    this.pending = [];
    for (const text of queued) this.writeEmitter.fire(text);
  }
  // Closing the terminal ends whatever it was running; nothing is left to read
  // the program's output or feed it stdin.
  close() { stopRun(this); }
  raw(text) {
    if (!this.opened) { this.pending.push(text); return; }
    this.writeEmitter.fire(text);
  }
  write(text) { this.raw(String(text).replace(/\r?\n/g, '\r\n')); }
  dim(text) { this.raw('\x1b[2m' + text + '\x1b[0m\r\n'); }

  handleInput(data) {
    for (const ch of data) {
      if (ch === '\x03') { // Ctrl+C works whether or not a program is running
        this.raw('^C\r\n'); this.line = ''; stopActiveRun(); continue;
      }
      // Only a running program reads stdin. Ignore (and don't echo) anything
      // typed while idle, so keystrokes entered before Run never linger in the
      // line buffer and get swallowed by the program's first input() call.
      if (this.mode !== 'run' && this.mode !== 'exec') continue;
      if (ch === '\r') {
        this.raw('\r\n');
        const line = this.line; this.line = '';
        if (this.mode === 'run' && this.runId) {
          req('POST', '/api/run/stdin?run=' + encodeURIComponent(this.runId), enc(line));
        } else if (this.mode === 'exec' && this.execRun) {
          req('POST', '/api/run/exec/input?run=' + encodeURIComponent(this.execRun), enc(line));
        }
      } else if (ch === '\x7f' || ch === '\b') {
        if (this.line.length) { this.line = this.line.slice(0, -1); this.raw('\b \b'); }
      } else if (ch >= ' ') {
        this.line += ch; this.raw(ch);
      }
    }
  }
}

let term = null, termInstance = null;
function getTerminal() {
  if (!term) {
    termInstance = new RunTerminal();
    term = vscode.window.createTerminal({ name: 'LC3 Run', pty: termInstance });
  }
  return { ui: term, pty: termInstance };
}

// Trashing the terminal disposes it for good, so drop the cached reference:
// otherwise the next Run shows a dead terminal and its output goes nowhere.
function forgetTerminal(closed) {
  if (closed && closed !== term) return;
  term = null;
  termInstance = null;
}

function stopRun(pty) {
  if (!pty) return;
  if (pty.execRun) {
    req('POST', '/api/run/exec/kill?run=' + encodeURIComponent(pty.execRun));
    pty.execRun = null;
  }
  if (pty.runId) {
    req('POST', '/api/run/stdin?run=' + encodeURIComponent(pty.runId) + '&end=1');
    if (bc) bc.postMessage({ t: 'stop' }); // kill the Python worker (e.g. infinite loop)
    pty.runId = null;
  }
  pty.mode = 'idle';
  pty.line = '';
}

function stopActiveRun() { stopRun(termInstance); }

/* ---------------------------- worker shell ------------------------------- */
// A real terminal on a worker, for a teacher diagnosing a node that is acting
// up. Unlike the Run terminal this one is raw: every keystroke goes to the
// worker's pty as-is, so Ctrl+C, tab completion, and full-screen programs work.

function b64ToBytes(s) {
  const bin = atob(s || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class ShellTerminal {
  constructor(host) {
    this.host = host;
    this.writeEmitter = new vscode.EventEmitter();
    this.onDidWrite = this.writeEmitter.event;
    this.closeEmitter = new vscode.EventEmitter();
    this.onDidClose = this.closeEmitter.event;
    this.run = null;
    this.rows = 24;
    this.cols = 80;
    this.alive = false;
    // Output arrives in arbitrary chunks, so a multi-byte character can be
    // split across two polls; a streaming decoder stitches those back together.
    this.decoder = new TextDecoder('utf-8');
    // Keystrokes queue behind one request at a time. Firing a POST per key
    // lets the responses race, and the shell then receives them in whatever
    // order they land: "echo" typed quickly arrives as "ehco".
    this.outQueue = '';
    this.sending = false;
  }

  async open(dims) {
    if (dims) { this.rows = dims.rows || 24; this.cols = dims.columns || 80; }
    this.writeEmitter.fire('\x1b[2mconnecting to ' + this.host + '...\x1b[0m\r\n');
    let resp;
    try {
      resp = await req('POST', '/api/admin/shell/start',
        { host: this.host, rows: this.rows, cols: this.cols });
    } catch (e) { this.fail('could not reach the gateway'); return; }
    if (!resp.ok) {
      let d = ''; try { d = (await resp.json()).detail; } catch (e) {}
      this.fail(d || ('gateway returned ' + resp.status)); return;
    }
    const r = await resp.json();
    if (r.status === 'busy') { this.fail('this worker already has the most shells it allows'); return; }
    if (r.status !== 'running') { this.fail('the worker could not start a shell'); return; }
    this.run = r.run;
    this.alive = true;
    this.pump();
  }

  fail(message) {
    this.writeEmitter.fire('\x1b[31m' + message + '\x1b[0m\r\n');
    this.closeEmitter.fire(1);
  }

  async pump() {
    let since = 0;
    while (this.alive && this.run) {
      let resp;
      try {
        resp = await req('GET', '/api/admin/shell/output?run=' +
          encodeURIComponent(this.run) + '&since=' + since);
      } catch (e) { this.fail('[lost connection to ' + this.host + ']'); return; }
      if (!resp.ok) { this.fail('[worker stopped responding]'); return; }
      const j = await resp.json();
      if (j.data) {
        this.writeEmitter.fire(this.decoder.decode(b64ToBytes(j.data), { stream: true }));
      }
      since = j.next;
      if (j.done) {
        this.alive = false; this.run = null;
        this.writeEmitter.fire('\r\n\x1b[2m[shell closed, exit code ' + j.exit + ']\x1b[0m\r\n');
        this.closeEmitter.fire(j.exit);
        return;
      }
    }
  }

  handleInput(data) {
    if (!this.run) return;
    this.outQueue += data;
    this.drain();
  }

  async drain() {
    if (this.sending) return; // already draining; the queue will be picked up
    this.sending = true;
    try {
      while (this.outQueue && this.run) {
        const chunk = this.outQueue;
        this.outQueue = '';
        await req('POST', '/api/admin/shell/input?run=' + encodeURIComponent(this.run),
          { data: bytesToB64(new TextEncoder().encode(chunk)) });
      }
    } catch (e) {
      // A dropped keystroke is not worth killing the shell over; the poll loop
      // reports the connection if it is really gone.
    } finally {
      this.sending = false;
    }
  }

  setDimensions(dims) {
    if (!dims) return;
    this.rows = dims.rows; this.cols = dims.columns;
    if (!this.run) return;
    req('POST', '/api/admin/shell/resize?run=' + encodeURIComponent(this.run),
      { rows: this.rows, cols: this.cols });
  }

  close() {
    this.alive = false;
    this.outQueue = '';
    if (this.run) {
      req('POST', '/api/admin/shell/kill?run=' + encodeURIComponent(this.run));
      this.run = null;
    }
  }
}

function openWorkerShell(host, label) {
  const pty = new ShellTerminal(host);
  const t = vscode.window.createTerminal({ name: 'worker ' + (label || host), pty });
  t.show();
  return t;
}

/* ---------------------------- run controller ----------------------------- */

let bc = null;
let diagnostics = null;
let me = { username: '', role: '', lang: '' };
const runtimePending = new Map(); // reqId -> resolver, for format round-trips

// Ask the runtime iframe something and await its reply (used for formatting).
function runtimeRequest(msg, timeoutMs) {
  return new Promise((resolve) => {
    if (!bc) { resolve(null); return; }
    const reqId = rid();
    const timer = setTimeout(() => { runtimePending.delete(reqId); resolve(null); }, timeoutMs);
    runtimePending.set(reqId, (data) => { clearTimeout(timer); resolve(data); });
    bc.postMessage(Object.assign({ reqId }, msg));
  });
}

function activeLc3File() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.uri.scheme !== 'lc3') return null;
  return ed.document.uri.path;
}

function langFor(path) {
  // The file decides how it runs. The class language only chooses which engine
  // is preloaded; the runtime loads the other on demand if a file needs it.
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.py')) return 'python';
  return me.lang || 'python';
}

function parseJavacDiags(text, entry) {
  // e.g. Greeter.java:5: error: ';' expected
  const diags = [];
  const re = /(^|\n)([\w./$-]+\.java):(\d+): (error|warning): ([^\n]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    diags.push({ file: m[2].split('/').pop(), line: parseInt(m[3], 10), col: 1,
                 message: m[5], severity: m[4] === 'warning' ? 'warning' : 'error' });
  }
  return diags;
}

// Java runs on a real JVM in the cluster. Compile + start on a runner, then
// stream its stdout to the terminal and its typed lines back to stdin, so
// Scanner/System.in actually wait for input.
async function runJavaCluster(path, pty) {
  pty.dim('[compiling and starting on the cluster]');
  let resp;
  try { resp = await req('POST', '/api/run/exec/start', { path }); }
  catch (e) { pty.dim('could not reach a runner'); return; }
  if (!resp.ok) {
    let d = ''; try { d = (await resp.json()).detail; } catch (e) {}
    pty.dim('run failed: ' + (d || resp.status)); return;
  }
  const r = await resp.json();
  if (r.status === 'busy') { pty.dim('all runners are busy right now; try again in a moment'); return; }
  if (r.status === 'compile_error') {
    pty.write((r.output || 'compile error') + '\n');
    applyDiags(path, parseJavacDiags(r.output || '', path.split('/').pop()));
    pty.dim('[compile error]'); return;
  }
  if (r.status !== 'running') { pty.dim('could not start the program'); return; }
  applyDiags(path, []); // clear old diagnostics
  pty.mode = 'exec'; pty.execRun = r.run;
  const serverRun = r.run;
  let since = 0, outAll = '';
  while (pty.execRun === serverRun) {
    let o;
    try { o = await req('GET', '/api/run/exec/output?run=' + encodeURIComponent(serverRun) + '&since=' + since); }
    catch (e) { pty.dim('[lost connection to the runner]'); break; }
    if (!o.ok) { pty.dim('[runner error]'); break; }
    const j = await o.json();
    if (j.data) { pty.write(j.data); outAll += j.data; }
    since = j.next;
    if (j.done) {
      pty.dim('[finished, exit code ' + j.exit + ']');
      // Highlight the offending line if the program threw at runtime.
      if (j.exit !== 0) applyDiags(path, parseJavaRuntimeError(outAll, path.split('/').pop()));
      if (pty.execRun === serverRun) { pty.execRun = null; pty.mode = 'idle'; }
      break;
    }
  }
}

// Pull the first stack frame in the student's own file out of a Java trace and
// pair it with the exception message, so a runtime error squiggles the line.
function parseJavaRuntimeError(text, entry) {
  const frameRe = new RegExp('\\(' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)\\)');
  const m = frameRe.exec(text);
  if (!m) return [];
  let msg = 'runtime error';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/(Exception|Error)\b/.test(t) && !t.startsWith('at ')) { msg = t.replace(/^Exception in thread "\w+"\s*/, ''); break; }
  }
  return [{ line: parseInt(m[1], 10), col: 1, message: msg, severity: 'error' }];
}

async function runCommand() {
  const path = activeLc3File();
  if (!path) { vscode.window.showWarningMessage('Open a .py or .java file first.'); return; }
  await vscode.workspace.saveAll(false);
  const lang = langFor(path);
  const { ui, pty } = getTerminal();
  ui.show(); // focus the terminal so the student can type input into it
  stopActiveRun(); // end any run already in progress
  pty.raw('\r\n\x1b[1m$ run ' + path.split('/').pop() + '\x1b[0m\r\n');

  if (lang === 'java') {
    await runJavaCluster(path, pty);
  } else {
    if (!bc) { pty.dim('the Python runtime is not loaded; reload the page'); return; }
    const runId = rid();
    pty.runId = runId; pty.mode = 'run';
    bc.postMessage({ t: 'run', runId, lang: 'python', path });
  }
}

async function submitCommand() {
  const path = activeLc3File();
  if (!path) { vscode.window.showWarningMessage('Open a file inside an assignment folder first.'); return; }
  const assignment = path.split('/').filter(Boolean)[0];
  if (!assignment) { vscode.window.showWarningMessage('Put your work in an assignment folder before submitting.'); return; }
  await vscode.workspace.saveAll(false);
  const pick = me.role === 'teacher'
    ? await vscode.window.showInformationMessage(
      'Run "' + assignment + '" through grading the way a student would? ' +
      'The starter is graded against the tests, and nothing is recorded.',
      { modal: true }, 'Run tests')
    : await vscode.window.showWarningMessage(
      'Submit "' + assignment + '" for grading?', { modal: true }, 'Submit');
  if (pick !== 'Submit' && pick !== 'Run tests') return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Grading ' + assignment + '...' },
    async () => {
      // For a teacher this is the same grading path a student's submission
      // takes, over the starter they publish; it just is not recorded.
      let resp;
      try { resp = await req('POST', '/api/submit', { assignment }); }
      catch (e) { vscode.window.showErrorMessage('Could not reach the grader.'); return; }
      if (!resp.ok) {
        let msg = 'Submit failed (' + resp.status + ')';
        try { msg += ': ' + (await resp.json()).detail; } catch (e) {}
        vscode.window.showErrorMessage(msg); return;
      }
      const r = await resp.json();
      const { ui, pty } = getTerminal();
      ui.show(true);
      pty.raw('\r\n\x1b[1m$ submit ' + assignment + '\x1b[0m\r\n');
      if (r.dry_run) pty.dim('grading the starter against the tests, as a student would; not recorded');
      for (const t of r.tests) {
        pty.raw((t.passed ? '\x1b[32m  PASS  \x1b[0m' : '\x1b[31m  FAIL  \x1b[0m') + t.name + '\r\n');
      }
      pty.dim('result: ' + r.passed + ' passed, ' + r.failed + ' failed  (status: ' + r.status + ')');
      const whose = r.dry_run ? 'the starter' : 'your code';
      if (r.status === 'compile_error') {
        vscode.window.showErrorMessage(assignment + ': ' + whose + ' does not compile. Use Run to see details.');
      } else if (r.status === 'timeout') {
        vscode.window.showErrorMessage(assignment + ': ' + whose + ' ran too long (infinite loop?).');
      } else if (r.failed === 0 && r.passed > 0) {
        vscode.window.showInformationMessage(assignment + ': all ' + r.passed + ' tests passed!');
      } else {
        vscode.window.showWarningMessage(assignment + ': ' + r.passed + ' passed, ' + r.failed + ' failed.');
      }
    });
}

/* ----------------------------- diagnostics ------------------------------- */

function applyDiags(path, diags) {
  const folder = path.slice(0, path.lastIndexOf('/') + 1);
  const byUri = new Map();
  for (const d of (diags || [])) {
    const p = d.file ? folder + d.file : path;
    const uri = vscode.Uri.from({ scheme: 'lc3', path: p });
    const line = Math.max(0, (d.line || 1) - 1);
    const col = Math.max(0, (d.col || 1) - 1);
    const range = new vscode.Range(line, col, line, 4096);
    const sev = d.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
    const list = byUri.get(uri.toString()) || [];
    list.push(new vscode.Diagnostic(range, d.message || 'error', sev));
    byUri.set(uri.toString(), list);
  }
  // Always clear the run file first, then set whatever came back.
  diagnostics.set(vscode.Uri.from({ scheme: 'lc3', path }), []);
  for (const [key, list] of byUri) diagnostics.set(vscode.Uri.parse(key), list);
}

function onRuntimeMessage(ev) {
  const m = ev.data || {};
  // Program output lands in the terminal. If the student trashed it the run was
  // stopped with it, so late messages are dropped rather than resurrecting it.
  if (m.t === 'out' || m.t === 'status' || m.t === 'exit') {
    const t = termInstance;
    if (!t) return;
    if (t.runId && m.runId && t.runId !== m.runId) return; // a stale/other run
    if (m.t === 'out') {
      t.write(m.data);
    } else if (m.t === 'status') {
      t.dim('[' + m.text + ']');
    } else if (m.t === 'exit') {
      t.dim('[finished, exit code ' + m.code + ']');
      t.runId = null; t.mode = 'idle';
    }
    return;
  }
  if (m.t === 'diags') {
    applyDiags(m.path, m.diags);
  } else if (m.t === 'formatted') {
    const cb = runtimePending.get(m.reqId);
    if (cb) { runtimePending.delete(m.reqId); cb(m); }
  } else if (m.t === 'ready') {
    if (m.error && termInstance) termInstance.dim('runtime warning: ' + m.error);
  }
}

/* --------------------------- admin (teacher) ----------------------------- */
// Native VS Code UI: a tree view of classes, students, assignments, workers,
// and submissions, with actions run through input boxes and the file-open
// dialog. Webviews are not available over plain HTTP, so nothing here uses one.

let adminTree = null;

async function getJSON(path) {
  const r = await req('GET', path);
  if (!r.ok) throw new Error('server returned ' + r.status);
  return r.json();
}
async function postJSON(path, body) {
  const r = await req('POST', path, body);
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((j && j.detail) || ('server returned ' + r.status));
  return j;
}
function adminError(e) { vscode.window.showErrorMessage('LC3: ' + ((e && e.message) || e)); }

// How busy a node is, in the one line the tree has room for: the runs it is
// carrying out of the runs it accepts, then the machine's own load.
function workerSummary(w) {
  const l = w.load || {};
  if (w.status === 'provisioning') return 'provisioning';
  if (!l.reachable) return w.status + '  ·  no load report';
  const parts = [w.status, 'runs ' + (l.runs || 0) + '/' + (l.max_runs || 0)];
  if (l.grades) parts.push('grading ' + l.grades);
  if (l.shells) parts.push('shells ' + l.shells);
  const avg = (l.loadavg || [])[0];
  if (avg !== undefined) {
    // Load is per-core on the machine reporting it; a Pi 3 has 4, the Pi 4 has 4.
    parts.push('cpu ' + Math.round((avg / Math.max(1, l.cpus || 1)) * 100) + '%');
  }
  if (l.mem_total_mb) parts.push((l.mem_avail_mb || 0) + ' MB free');
  return parts.join('  ·  ');
}

function workerDetail(w) {
  const l = w.load || {};
  const lines = ['**' + w.host + '**' + (w.local ? ' (gateway)' : ''), '', 'status: ' + w.status];
  if (w.note) lines.push('note: ' + w.note);
  if (!l.reachable) {
    lines.push('', 'The runner on this node did not answer, so there is no load to show.');
    return lines.join('\n\n');
  }
  lines.push('interactive runs: ' + (l.runs || 0) + ' of ' + (l.max_runs || 0) +
    ' (' + (l.dispatched || 0) + ' routed from this gateway)');
  lines.push('grading: ' + (l.grades || 0) + ' of ' + (l.max_grades || 0) +
    ' (' + (l.grading || 0) + ' sent from this gateway)');
  lines.push('load average: ' + (l.loadavg || []).join(', ') + ' over ' + (l.cpus || 1) + ' cpus');
  lines.push('memory: ' + (l.mem_avail_mb || 0) + ' MB free of ' + (l.mem_total_mb || 0) + ' MB');
  lines.push('java: ' + (l.java ? 'installed' : 'missing'));
  lines.push('shell: ' + (l.shell_available ? 'available' : 'not configured on this node'));
  return lines.join('\n\n');
}

function sectionItem(label, ctx, icon) {
  const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  it.contextValue = ctx;              // sec:classes, sec:students, ...
  it.section = ctx.split(':')[1];
  it.iconPath = new vscode.ThemeIcon(icon);
  return it;
}

class AdminTree {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  refresh() { this._emitter.fire(); }
  getTreeItem(e) { return e; }
  async getChildren(node) {
    if (!node) {
      return [
        sectionItem('Classes', 'sec:classes', 'symbol-class'),
        sectionItem('Students', 'sec:students', 'account'),
        sectionItem('Assignments', 'sec:assignments', 'book'),
        sectionItem('Workers', 'sec:workers', 'server-environment'),
        sectionItem('Recent submissions', 'sec:submissions', 'checklist'),
      ];
    }
    try {
      if (node.section === 'classes') {
        const j = await getJSON('/api/admin/classes');
        return (j.classes || []).map((c) => {
          const it = new vscode.TreeItem(c.id + '  ·  ' + c.lang);
          it.description = c.name + (c.signup_open
            ? '  ·  joining with ' + (c.code || '(no code)')
            : '  ·  closed to new accounts');
          it.contextValue = c.signup_open ? 'class.open' : 'class';
          it.lc3 = c;
          it.iconPath = new vscode.ThemeIcon('symbol-class');
          it.tooltip = new vscode.MarkdownString(
            '**' + c.id + '**  ' + c.name + ' (' + c.lang + ')\n\n' +
            'join code: `' + (c.code || '(none yet)') + '`\n\n' +
            (c.signup_open
              ? 'Students can create accounts in this class right now.'
              : 'Sign-ups are closed. Open them for the lesson, then close them again.'));
          return it;
        });
      }
      if (node.section === 'students') {
        const j = await getJSON('/api/admin/students');
        return (j.users || []).filter((u) => u.role === 'student').map((u) => {
          const it = new vscode.TreeItem(u.username);
          it.description = u.class || '(no class)'; it.contextValue = 'student'; it.lc3 = u;
          it.iconPath = new vscode.ThemeIcon('account');
          return it;
        });
      }
      if (node.section === 'assignments') {
        const j = await getJSON('/api/assignments');
        return (j.assignments || []).map((a) => {
          const it = new vscode.TreeItem(a.id);
          it.description = (a.classes || []).join(', ') + '  ·  ' + a.language +
            (a.closed ? '  ·  closed' : '');
          it.contextValue = 'assignment'; it.lc3 = a;
          it.iconPath = new vscode.ThemeIcon(a.closed ? 'lock' : 'book');
          return it;
        });
      }
      if (node.section === 'workers') {
        const j = await getJSON('/api/admin/workers');
        return (j.workers || []).map((w) => {
          const it = new vscode.TreeItem(w.host + (w.local ? '  (gateway)' : ''));
          it.description = workerSummary(w);
          it.contextValue = w.local ? 'worker.local' : 'worker'; it.lc3 = w;
          it.iconPath = new vscode.ThemeIcon(
            w.status === 'up' ? 'pass' : (w.status === 'error' ? 'error' : 'circle-slash'));
          it.tooltip = new vscode.MarkdownString(workerDetail(w));
          return it;
        });
      }
      if (node.section === 'submissions') {
        const j = await getJSON('/api/admin/submissions');
        return (j.submissions || []).slice(0, 50).map((s) => {
          const it = new vscode.TreeItem(s.username + ' · ' + s.assignment);
          it.description = s.passed + '/' + (s.passed + s.failed) + '  (' + s.status + ')';
          it.contextValue = 'submission';
          it.iconPath = new vscode.ThemeIcon(s.failed === 0 && s.passed > 0 ? 'pass' : 'warning');
          return it;
        });
      }
    } catch (e) {
      const it = new vscode.TreeItem('(failed to load - ' + ((e && e.message) || e) + ')');
      return [it];
    }
    return [];
  }
}

async function pickClass(placeHolder, includeNone) {
  const j = await getJSON('/api/admin/classes');
  const items = (j.classes || []).map((c) => ({ label: c.id, description: c.name + ' (' + c.lang + ')' }));
  if (includeNone) items.unshift({ label: '(no class)', description: '', _none: true });
  if (!items.length) { vscode.window.showWarningMessage('LC3: create a class first.'); return undefined; }
  const p = await vscode.window.showQuickPick(items, { placeHolder });
  if (!p) return undefined;
  return p._none ? '' : p.label;
}

async function pickClasses(placeHolder) {
  const j = await getJSON('/api/admin/classes');
  const classes = j.classes || [];
  if (!classes.length) { vscode.window.showWarningMessage('LC3: create a class first.'); return undefined; }
  const picks = await vscode.window.showQuickPick(
    classes.map((c) => ({ label: c.id, description: c.name + ' (' + c.lang + ')', lang: c.lang })),
    { placeHolder, canPickMany: true });
  if (!picks || !picks.length) return undefined;
  const langs = new Set(picks.map((p) => p.lang));
  if (langs.size > 1) {
    vscode.window.showErrorMessage('LC3: an assignment can only span classes of the same language.');
    return undefined;
  }
  return picks.map((p) => p.label);
}

async function confirmModal(message) {
  const pick = await vscode.window.showWarningMessage(message, { modal: true }, 'Yes');
  return pick === 'Yes';
}

function bytesToB64(bytes) {
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function registerAdmin(context) {
  adminTree = new AdminTree();
  // Read-only view of a recalled submission's files (scheme lc3grade:).
  const gradeDocs = {
    provideTextDocumentContent: async (uri) => {
      const parts = uri.path.replace(/^\//, '').split('/');
      const assignment = parts.shift(), user = parts.shift(), rel = parts.join('/');
      try {
        const r = await req('GET', '/api/admin/collected/read?assignment=' +
          encodeURIComponent(assignment) + '&user=' + encodeURIComponent(user) +
          '&path=' + encodeURIComponent(rel));
        return r.ok ? await r.text() : '// could not load ' + rel;
      } catch (e) { return '// error loading ' + rel; }
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('lc3grade', gradeDocs),
    vscode.window.registerTreeDataProvider('lc3.admin', adminTree),
    vscode.commands.registerCommand('lc3.admin.refresh', () => adminTree.refresh()),

    vscode.commands.registerCommand('lc3.addClass', async () => {
      try {
        const id = await vscode.window.showInputBox({ prompt: 'Class id (letters, numbers, - or _)' });
        if (!id) return;
        const name = await vscode.window.showInputBox({ prompt: 'Class name', value: id });
        if (name === undefined) return;
        const lang = await vscode.window.showQuickPick(['python', 'java'], { placeHolder: 'Language' });
        if (!lang) return;
        await postJSON('/api/admin/classes', { id: id.trim(), name, lang });
        adminTree.refresh();
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.deleteClass', async (item) => {
      const id = item && item.lc3 && item.lc3.id; if (!id) return;
      if (!await confirmModal('Delete class "' + id + '"? Its students keep their accounts but lose the class.')) return;
      try { await postJSON('/api/admin/classes/delete', { id }); adminTree.refresh(); } catch (e) { adminError(e); }
    }),

    vscode.commands.registerCommand('lc3.classCode', async (item) => {
      const c = (item && item.lc3) || {};
      if (!c.id) return;
      if (!c.code) {
        vscode.window.showWarningMessage('LC3: "' + c.id + '" has no join code yet. Use New Join Code.');
        return;
      }
      // Copying beats reading it back off a tooltip when it goes on the board.
      await vscode.env.clipboard.writeText(c.code);
      vscode.window.showInformationMessage(
        'LC3: join code for "' + c.id + '" is ' + c.code + ' (copied). ' +
        (c.signup_open ? 'Sign-ups are open.' : 'Sign-ups are closed; open them before the lesson.'));
    }),
    vscode.commands.registerCommand('lc3.newClassCode', async (item) => {
      const c = (item && item.lc3) || {};
      if (!c.id) return;
      if (c.code && !await confirmModal('Give "' + c.id +
        '" a new join code? The current one stops working immediately.')) return;
      try {
        const j = await postJSON('/api/admin/classes/code', { id: c.id });
        adminTree.refresh();
        await vscode.env.clipboard.writeText(j.code);
        vscode.window.showInformationMessage(
          'LC3: new join code for "' + c.id + '" is ' + j.code + ' (copied).');
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.toggleSignup', async (item) => {
      const c = (item && item.lc3) || {};
      if (!c.id) return;
      const open = !c.signup_open;
      try {
        await postJSON('/api/admin/classes/signup', { id: c.id, open });
        adminTree.refresh();
        vscode.window.showInformationMessage(open
          ? 'LC3: "' + c.id + '" is accepting accounts with code ' + (c.code || '(none)') + '.'
          : 'LC3: "' + c.id + '" is closed to new accounts.');
      } catch (e) { adminError(e); }
    }),

    vscode.commands.registerCommand('lc3.addStudent', async () => {
      try {
        const username = await vscode.window.showInputBox({ prompt: 'Student username' });
        if (!username) return;
        const password = await vscode.window.showInputBox({ prompt: 'Password' });
        if (!password) return;
        const cls = await pickClass('Class for this student', true);
        if (cls === undefined) return;
        await postJSON('/api/admin/students', { username: username.trim(), password, class: cls });
        adminTree.refresh();
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.setStudentClass', async (item) => {
      const username = item && item.lc3 && item.lc3.username; if (!username) return;
      const cls = await pickClass('Move ' + username + ' to class', true);
      if (cls === undefined) return;
      try { await postJSON('/api/admin/students/setclass', { username, class: cls }); adminTree.refresh(); } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.deleteStudent', async (item) => {
      const username = item && item.lc3 && item.lc3.username; if (!username) return;
      if (!await confirmModal('Delete student "' + username + '"?')) return;
      try { await postJSON('/api/admin/students/delete', { username }); adminTree.refresh(); } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.resetPassword', async (item) => {
      const username = item && item.lc3 && item.lc3.username; if (!username) return;
      const pw = await vscode.window.showInputBox({ prompt: 'New password for ' + username });
      if (!pw) return;
      try {
        await postJSON('/api/admin/students/setpassword', { username, password: pw });
        vscode.window.showInformationMessage('LC3: reset password for ' + username + '.');
      } catch (e) { adminError(e); }
    }),

    vscode.commands.registerCommand('lc3.createAssignment', async () => {
      try {
        const classes = await pickClasses('Class(es) for this assignment (space to select more)');
        if (!classes) return;
        const active = vscode.window.activeTextEditor;
        const def = (active && active.document.uri.scheme === 'lc3')
          ? active.document.uri.path.replace(/\/[^/]*$/, '') : '';
        const folder = await vscode.window.showInputBox({
          prompt: 'Folder in your files containing starter/ and tests/', value: def });
        if (!folder) return;
        const id = await vscode.window.showInputBox({ prompt: 'Assignment id (blank = folder name)' });
        if (id === undefined) return;
        const j = await postJSON('/api/admin/assignments/from-folder',
          { folder, id: id.trim(), classes });
        adminTree.refresh();
        vscode.window.showInformationMessage(
          'LC3: created "' + j.id + '" and published to ' + j.published_to + ' students.');
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.deleteAssignment', async (item) => {
      const id = item && item.lc3 && item.lc3.id; if (!id) return;
      if (!await confirmModal('Delete assignment "' + id +
        '"? This removes it, its grades, and every student\'s copy.')) return;
      try { await postJSON('/api/admin/assignments/delete', { id }); adminTree.refresh(); } catch (e) { adminError(e); }
    }),

    vscode.commands.registerCommand('lc3.uploadAssignment', async () => {
      try {
        const classes = await pickClasses('Class(es) for this assignment (space to select more)');
        if (!classes) return;
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false, openLabel: 'Upload', filters: { 'Zip archives': ['zip'] } });
        if (!uris || !uris.length) return;
        const bytes = await vscode.workspace.fs.readFile(uris[0]);
        const id = await vscode.window.showInputBox({
          prompt: 'Assignment id (leave blank to use assignment.json in the zip)' });
        if (id === undefined) return;
        const j = await postJSON('/api/admin/assignments/upload',
          { classes, id: id.trim(), zip_b64: bytesToB64(bytes) });
        vscode.window.showInformationMessage(
          'LC3: uploaded "' + j.id + '" to ' + classes.join(', ') +
          ' and published to ' + j.published_to + ' students.');
        adminTree.refresh();
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.publishAssignment', async (item) => {
      const id = item && item.lc3 && item.lc3.id; if (!id) return;
      try {
        const j = await postJSON('/api/admin/assignments/publish', { id });
        adminTree.refresh();
        vscode.window.showInformationMessage('LC3: published "' + id + '" to ' + j.published_to + ' students.');
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.unpublishAssignment', async (item) => {
      const id = item && item.lc3 && item.lc3.id; if (!id) return;
      try {
        await postJSON('/api/admin/assignments/unpublish', { id });
        adminTree.refresh();
        vscode.window.showInformationMessage('LC3: unpublished "' + id + '" (hidden from students).');
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.recallAssignment', async (item) => {
      const id = item && item.lc3 && item.lc3.id; if (!id) return;
      try {
        const j = await postJSON('/api/admin/assignments/recall', { id });
        vscode.window.showInformationMessage('LC3: recalled ' + j.collected + ' submissions for "' + id + '".');
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.gradeAssignment', async (item) => {
      const id = item && item.lc3 && item.lc3.id; if (!id) return;
      try {
        await postJSON('/api/admin/assignments/recall', { id }); // fresh snapshot
        const col = await getJSON('/api/admin/collected?assignment=' + encodeURIComponent(id));
        const students = col.students || [];
        if (!students.length) {
          vscode.window.showInformationMessage('LC3: no submissions to grade yet for "' + id + '".');
          return;
        }
        // Grade students one by one until the teacher dismisses the picker.
        for (;;) {
          const pick = await vscode.window.showQuickPick(
            students.map((s) => ({
              label: s.username,
              description: (s.score ? 'grade: ' + s.score : 'ungraded') +
                '  ·  ' + (s.files.length ? s.files.length + ' files' : 'no work'),
              s,
            })),
            { placeHolder: 'Grade "' + id + '" - pick a student (Esc when done)' });
          if (!pick) break;
          const s = pick.s;
          for (const f of s.files.slice(0, 8)) {
            const uri = vscode.Uri.parse('lc3grade:/' + id + '/' + s.username + '/' + f);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
          }
          const score = await vscode.window.showInputBox(
            { prompt: 'Grade for ' + s.username + ' on "' + id + '"', value: s.score || '' });
          if (score === undefined) continue;
          const comment = await vscode.window.showInputBox(
            { prompt: 'Comment (optional)', value: s.comment || '' });
          await postJSON('/api/admin/grade',
            { assignment: id, username: s.username, score, comment: comment || '' });
          s.score = score; s.comment = comment || '';
          adminTree.refresh();
        }
      } catch (e) { adminError(e); }
    }),

    vscode.commands.registerCommand('lc3.addWorker', async () => {
      try {
        const host = await vscode.window.showInputBox({ prompt: 'Raspberry Pi 3 IP address' });
        if (!host) return;
        const user = await vscode.window.showInputBox({ prompt: 'SSH user', value: 'alarm' });
        if (user === undefined) return;
        const password = await vscode.window.showInputBox({ prompt: 'SSH password', value: 'alarm' });
        if (password === undefined) return;
        const root = await vscode.window.showInputBox({ prompt: 'Root password', value: 'root' });
        if (root === undefined) return;
        await postJSON('/api/admin/workers', { host: host.trim(), user, password, root_password: root });
        vscode.window.showInformationMessage('LC3: provisioning started; use Recheck in a minute.');
        adminTree.refresh();
      } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.recheckWorkers', async () => {
      try { await postJSON('/api/admin/workers/recheck', {}); adminTree.refresh(); } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.deleteWorker', async (item) => {
      const host = item && item.lc3 && item.lc3.host; if (!host) return;
      if (!await confirmModal('Remove worker "' + host + '"?')) return;
      try { await postJSON('/api/admin/workers/delete', { host }); adminTree.refresh(); } catch (e) { adminError(e); }
    }),
    vscode.commands.registerCommand('lc3.workerTerminal', async (item) => {
      const w = (item && item.lc3) || {};
      if (!w.host) return;
      if (w.load && w.load.reachable && !w.load.shell_available) {
        vscode.window.showWarningMessage(
          'LC3: ' + w.host + ' has no shell. Set LC3_SHELL_TOKEN on that node and on the gateway.');
        return;
      }
      openWorkerShell(w.host, w.local ? 'gateway' : w.host);
    }),

    vscode.commands.registerCommand('lc3.newAssignment', async () => {
      try {
        const lang = await vscode.window.showQuickPick(['python', 'java'],
          { placeHolder: 'Language for the new assignment' });
        if (!lang) return;
        const folder = await vscode.window.showInputBox({
          prompt: 'Folder name in your files (letters, numbers, - or _)',
          placeHolder: 'unit3-cart' });
        if (!folder) return;
        const title = await vscode.window.showInputBox({
          prompt: 'Title students see', value: folder });
        if (title === undefined) return;
        const j = await postJSON('/api/admin/assignments/template',
          { folder: folder.trim(), language: lang, title });
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
        // Open the starter so the teacher lands on the file they will edit.
        const uri = vscode.Uri.from({ scheme: 'lc3', path: '/' + j.folder + '/starter/' + j.entry });
        try {
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
        } catch (e) { /* the tree refresh is enough */ }
        vscode.window.showInformationMessage(
          'LC3: created "' + j.folder + '". Press Submit to run it the way a student would, ' +
          'then publish it with Create Assignment from Folder.');
      } catch (e) { adminError(e); }
    }));

  // Refresh the workers and submissions view periodically.
  const timer = setInterval(() => adminTree.refresh(), 15000);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(timer)));
}

/* ------------------------------- activate -------------------------------- */

async function closeWelcomeTabs() {
  try {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const label = (tab.label || '').toLowerCase();
        if (label.includes('welcome') || label.includes('get started') ||
            label.includes('getting started')) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  } catch (e) { /* tab API missing or nothing to close */ }
}

let activated = false;

async function activate(context) {
  if (activated) return; // never wire up the run channel or commands twice
  activated = true;

  const fs = new Lc3Fs();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('lc3', fs, { isCaseSensitive: true }));

  diagnostics = vscode.languages.createDiagnosticCollection('lc3');
  context.subscriptions.push(diagnostics);

  // Close the "Get Started" / Welcome tab so students land straight on their
  // files, and so it never steals keyboard focus.
  closeWelcomeTabs();
  setTimeout(closeWelcomeTabs, 1200);

  // Force the dark theme (the workbench default renders light otherwise).
  try {
    const wb = vscode.workspace.getConfiguration('workbench');
    if (wb.get('colorTheme') !== 'Default Dark Modern') {
      await wb.update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    }
  } catch (e) { /* theme not settable; ignore */ }

  try {
    const resp = await req('GET', '/api/me');
    if (resp.ok) me = await resp.json();
  } catch (e) {}

  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel('lc3-run');
    bc.onmessage = onRuntimeMessage;
    context.subscriptions.push(new vscode.Disposable(() => bc.close()));
  }

  // Let Run build a fresh terminal after the student trashes the old one.
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => forgetTerminal(closed)));

  context.subscriptions.push(
    vscode.commands.registerCommand('lc3.run', runCommand),
    vscode.commands.registerCommand('lc3.submit', submitCommand),
    vscode.commands.registerCommand('lc3.format', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.document.uri.scheme !== 'lc3') {
        vscode.window.showWarningMessage('Open a .py or .java file to format.'); return;
      }
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('lc3.refresh', () =>
      vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')),
    vscode.commands.registerCommand('lc3.logout', async () => {
      await req('POST', '/api/logout');
      vscode.window.showInformationMessage('Logged out. Reload the page to sign in again.');
    }),
    vscode.commands.registerCommand('lc3.changePassword', async () => {
      const current = await vscode.window.showInputBox({ prompt: 'Current password', password: true });
      if (!current) return;
      const next = await vscode.window.showInputBox({
        prompt: 'New password (at least 8 characters)', password: true,
        validateInput: (v) => (v && v.length >= 8 ? null : 'Use at least 8 characters.') });
      if (!next) return;
      const confirm = await vscode.window.showInputBox({ prompt: 'Retype the new password', password: true });
      if (confirm == null) return;
      if (confirm !== next) { vscode.window.showErrorMessage('The two new passwords do not match.'); return; }
      let resp;
      try { resp = await req('POST', '/api/account/password', { current, new: next }); }
      catch (e) { vscode.window.showErrorMessage('Could not reach the server.'); return; }
      if (!resp.ok) {
        let msg = 'Password change failed';
        try { msg = (await resp.json()).detail || msg; } catch (e) {}
        vscode.window.showErrorMessage('LC3: ' + msg); return;
      }
      vscode.window.showInformationMessage('LC3: password changed. Other sessions were signed out.');
    }));

  // Format Document (Shift+Alt+F): Python with black, Java with prettier, both
  // in the browser via the runtime iframe.
  const formatter = (lang) => ({
    provideDocumentFormattingEdits: async (doc) => {
      const src = doc.getText();
      const res = await runtimeRequest({ t: 'format', lang, path: doc.uri.path, text: src }, 30000);
      if (!res || res.text == null || res.text === src) return [];
      const full = new vscode.Range(doc.positionAt(0), doc.positionAt(src.length));
      return [vscode.TextEdit.replace(full, res.text)];
    },
  });
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'lc3', language: 'python' }, formatter('python')),
    vscode.languages.registerDocumentFormattingEditProvider({ scheme: 'lc3', language: 'java' }, formatter('java')));

  // Browser syntax check as the student saves: Python via Pyodide, Java via the
  // bundled JS parser. Both run in the hidden runtime iframe, no cluster load.
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'lc3' || !bc) return;
    if (doc.uri.path.endsWith('.py')) bc.postMessage({ t: 'check', lang: 'python', path: doc.uri.path });
    else if (doc.uri.path.endsWith('.java')) bc.postMessage({ t: 'check', lang: 'java', path: doc.uri.path });
  }));

  // status bar: identity + run/submit, plus admin for teachers.
  const idItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  idItem.text = '$(account) ' + (me.username || '');
  idItem.tooltip = me.class ? ('Class: ' + me.class) : 'Logged in to LC3';
  idItem.show();
  const runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  runItem.text = '$(play) Run'; runItem.command = 'lc3.run';
  runItem.tooltip = 'Run the open file in the terminal (F5)'; runItem.show();
  const subItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  subItem.text = '$(rocket) Submit'; subItem.command = 'lc3.submit';
  subItem.tooltip = 'Submit this assignment for grading'; subItem.show();
  const fmtItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  fmtItem.text = '$(list-flat) Format'; fmtItem.command = 'lc3.format';
  fmtItem.tooltip = 'Format the open file (black / prettier)'; fmtItem.show();
  context.subscriptions.push(idItem, runItem, subItem, fmtItem);

  if (me.role === 'teacher') {
    // Reveal the Class Management view container and wire up its actions.
    await vscode.commands.executeCommand('setContext', 'lc3.isTeacher', true);
    registerAdmin(context);
    const adminItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
    adminItem.text = '$(mortar-board) Class Management';
    adminItem.command = 'lc3.admin.focus';
    adminItem.tooltip = 'Open the Class Management panel'; adminItem.show();
    context.subscriptions.push(adminItem);
  }
}

module.exports = { activate };
