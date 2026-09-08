# LC3 web extension.
#
# Provides the student's whole workflow inside the VS Code page:
#   - a REST-backed file system on the lc3: scheme,
#   - Run, which executes the open file in a hidden same-origin runtime iframe
#     and streams its output into an integrated terminal (over a
#     BroadcastChannel the runtime and this extension share),
#   - Submit, which grades against the private tests on the cluster,
#   - a Python debugger, spoken straight to the workbench as an inline adapter,
#   - editor diagnostics (squiggles + Problems) from syntax and compile errors,
#   - a teacher-only Class Management panel that talks to the admin API through
#     this extension (a webview could not send the session cookie itself).
#
# extension.js is the shim that compiles this file and hands back activate.
# `vscode` and `module` come in from there. LiveScript has no async functions,
# so anything that would have been await is a promise chain, and a chain of
# prompts reads as a run of backcalls.

ORIGIN = if typeof self isnt 'undefined' and self.location then self.location.origin else ''
api = (path) -> ORIGIN + path

req = (method, path, body) ->
  opts = {method, credentials: 'same-origin'}
  if body isnt undefined
    if body instanceof Uint8Array
      opts.body = body
      opts.headers = {'Content-Type': 'application/octet-stream'}
    else
      opts.body = JSON.stringify body
      opts.headers = {'Content-Type': 'application/json'}
  fetch (api path), opts

rid = -> Math.random!.toString(36).slice 2, 10
enc = (s) -> new TextEncoder!.encode s

# ------------------------------- file system --------------------------------

fs-error = (status, uri) ->
  return vscode.FileSystemError.FileNotFound uri if status is 404
  return vscode.FileSystemError.NoPermissions 'Not logged in - reload the page' if status is 401
  vscode.FileSystemError.Unavailable 'LC3 server error ' + status

# One request, refused the way the workbench expects when the server says no.
fs-json = (method, path, uri, body) ->
  req method, path, body .then (resp) ->
    throw fs-error resp.status, uri unless resp.ok
    resp

class Lc3Fs
  ->
    @_emitter = new vscode.EventEmitter!
    @onDidChangeFile = @_emitter.event

  watch: -> new vscode.Disposable ->

  stat: (uri) ->
    if uri.path is '/' or uri.path is ''
      return Promise.resolve {type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0}
    fs-json 'GET', '/api/fs/stat?path=' + encodeURIComponent(uri.path), uri
      .then (resp) -> resp.json!
      .then (j) ->
        type: if j.type is 'dir' then vscode.FileType.Directory else vscode.FileType.File
        ctime: j.mtime
        mtime: j.mtime
        size: j.size

  readDirectory: (uri) ->
    fs-json 'GET', '/api/fs/list?path=' + encodeURIComponent(uri.path or '/'), uri
      .then (resp) -> resp.json!
      .then (j) ->
        for e in j.entries
          [e.name, (if e.type is 'dir' then vscode.FileType.Directory else vscode.FileType.File)]

  readFile: (uri) ->
    fs-json 'GET', '/api/fs/read?path=' + encodeURIComponent(uri.path), uri
      .then (resp) -> resp.arrayBuffer!
      .then (buf) -> new Uint8Array buf

  writeFile: (uri, content) ->
    fs-json 'POST', '/api/fs/write?path=' + encodeURIComponent(uri.path), uri, content
      .then ~> @_emitter.fire [{type: vscode.FileChangeType.Changed, uri: uri}]

  createDirectory: (uri) ->
    fs-json 'POST', '/api/fs/mkdir?path=' + encodeURIComponent(uri.path), uri .then -> void

  delete: (uri) ->
    fs-json 'POST', '/api/fs/delete?path=' + encodeURIComponent(uri.path), uri
      .then ~> @_emitter.fire [{type: vscode.FileChangeType.Deleted, uri: uri}]

  rename: (old-uri, new-uri) ->
    path = '/api/fs/rename?src=' + encodeURIComponent(old-uri.path) +
      '&dst=' + encodeURIComponent(new-uri.path)
    fs-json 'POST', path, old-uri .then -> void

# --------------------------------- terminal ---------------------------------
# A Pseudoterminal: pure JS, no backend pty. It renders streamed program output
# and, during a Python run, feeds typed lines to the program's stdin.

class RunTerminal
  ->
    @writeEmitter = new vscode.EventEmitter!
    @onDidWrite = @writeEmitter.event
    @closeEmitter = new vscode.EventEmitter!
    @onDidClose = @closeEmitter.event
    @line = ''
    @mode = 'idle'        # idle | run (python) | exec (cluster JVM)
    @runId = null         # python run id for the stdin relay
    @execRun = null       # cluster run id for interactive input
    # A pseudoterminal only starts receiving onDidWrite once the workbench has
    # opened it, which happens a tick or two after createTerminal. The first Run
    # writes its header before that, so hold output until open().
    @opened = false
    @pending = []

  open: ->
    @opened = true
    # The hint is only useful when nothing is waiting to be shown; on the first
    # Run the student wants their program's output, not instructions.
    if not @pending.length
      @raw '\x1b[2mLC3 terminal. Open a file and press Run (F5).\x1b[0m\r\n'
      return
    queued = @pending
    @pending = []
    for text in queued
      @writeEmitter.fire text

  # Closing the terminal ends whatever it was running; nothing is left to read
  # the program's output or feed it stdin.
  close: -> stop-run this

  raw: (text) ->
    if not @opened
      @pending.push text
      return
    @writeEmitter.fire text

  write: (text) -> @raw String(text).replace /\r?\n/g, '\r\n'
  dim: (text) -> @raw '\x1b[2m' + text + '\x1b[0m\r\n'

  handleInput: (data) ->
    for ch in data
      if ch is '\x03'  # Ctrl+C works whether or not a program is running
        @raw '^C\r\n'
        @line = ''
        stop-active-run!
        continue
      # Only a running program reads stdin. Ignore (and don't echo) anything
      # typed while idle, so keystrokes entered before Run never linger in the
      # line buffer and get swallowed by the program's first input() call.
      continue if @mode isnt 'run' and @mode isnt 'exec'
      if ch is '\r'
        @raw '\r\n'
        line = @line
        @line = ''
        if @mode is 'run' and @runId
          req 'POST', '/api/run/stdin?run=' + encodeURIComponent(@runId), enc line
        else if @mode is 'exec' and @execRun
          req 'POST', '/api/run/exec/input?run=' + encodeURIComponent(@execRun), enc line
      else if ch is '\x7f' or ch is '\b'
        if @line.length
          @line = @line.slice 0, -1
          @raw '\b \b'
      else if ch >= ' '
        @line += ch
        @raw ch

term = null
term-instance = null

get-terminal = ->
  if not term
    term-instance := new RunTerminal!
    term := vscode.window.createTerminal {name: 'LC3 Run', pty: term-instance}
  {ui: term, pty: term-instance}

# Trashing the terminal disposes it for good, so drop the cached reference:
# otherwise the next Run shows a dead terminal and its output goes nowhere.
forget-terminal = (closed) ->
  return if closed and closed isnt term
  term := null
  term-instance := null

stop-run = (pty) ->
  return unless pty
  if pty.execRun
    req 'POST', '/api/run/exec/kill?run=' + encodeURIComponent(pty.execRun)
    pty.execRun = null
  if pty.runId
    req 'POST', '/api/run/stdin?run=' + encodeURIComponent(pty.runId) + '&end=1'
    bc.postMessage {t: 'stop'} if bc  # kill the Python worker (e.g. infinite loop)
    pty.runId = null
  pty.mode = 'idle'
  pty.line = ''

stop-active-run = -> stop-run term-instance

# ------------------------------- worker shell -------------------------------
# A real terminal on a worker, for a teacher diagnosing a node that is acting
# up. Unlike the Run terminal this one is raw: every keystroke goes to the
# worker's pty as-is, so Ctrl+C, tab completion, and full-screen programs work.

b64-to-bytes = (s) ->
  bin = atob (s or '')
  out = new Uint8Array bin.length
  for i from 0 til bin.length
    out[i] = bin.charCodeAt i
  out

bytes-to-b64 = (bytes) ->
  bin = ''
  chunk = 0x8000
  i = 0
  while i < bytes.length
    bin += String.fromCharCode.apply null, bytes.subarray i, i + chunk
    i += chunk
  btoa bin

class ShellTerminal
  (host) ->
    @host = host
    @writeEmitter = new vscode.EventEmitter!
    @onDidWrite = @writeEmitter.event
    @closeEmitter = new vscode.EventEmitter!
    @onDidClose = @closeEmitter.event
    @run = null
    @rows = 24
    @cols = 80
    @alive = false
    # Output arrives in arbitrary chunks, so a multi-byte character can be split
    # across two polls; a streaming decoder stitches those back together.
    @decoder = new TextDecoder 'utf-8'
    # Keystrokes queue behind one request at a time. Firing a POST per key lets
    # the responses race, and the shell then receives them in whatever order they
    # land: "echo" typed quickly arrives as "ehco".
    @outQueue = ''
    @sending = false

  open: (dims) ->
    if dims
      @rows = dims.rows or 24
      @cols = dims.columns or 80
    @writeEmitter.fire '\x1b[2mconnecting to ' + @host + '...\x1b[0m\r\n'
    req 'POST', '/api/admin/shell/start', {host: @host, rows: @rows, cols: @cols}
      .then ((resp) ~>
        if not resp.ok
          return resp.json!.then ((j) ~> @fail (j?.detail or ('gateway returned ' + resp.status))),
                                 (~> @fail 'gateway returned ' + resp.status)
        resp.json!.then (r) ~>
          return @fail 'this worker already has the most shells it allows' if r.status is 'busy'
          return @fail 'the worker could not start a shell' if r.status isnt 'running'
          @run = r.run
          @alive = true
          @pump!),
        (~> @fail 'could not reach the gateway')

  fail: (message) ->
    @writeEmitter.fire '\x1b[31m' + message + '\x1b[0m\r\n'
    @closeEmitter.fire 1

  # One poll at a time, each one asking for whatever arrived after the last.
  pump: (since = 0) ->
    return unless @alive and @run
    req 'GET', '/api/admin/shell/output?run=' + encodeURIComponent(@run) + '&since=' + since
      .then ((resp) ~>
        return @fail '[worker stopped responding]' unless resp.ok
        resp.json!.then (j) ~>
          if j.data
            @writeEmitter.fire @decoder.decode (b64-to-bytes j.data), {stream: true}
          if j.done
            @alive = false
            @run = null
            @writeEmitter.fire '\r\n\x1b[2m[shell closed, exit code ' + j.exit + ']\x1b[0m\r\n'
            @closeEmitter.fire j.exit
            return
          @pump j.next),
        (~> @fail '[lost connection to ' + @host + ']')

  handleInput: (data) ->
    return unless @run
    @outQueue += data
    @drain!

  drain: ->
    return if @sending  # already draining; the queue will be picked up
    return unless @outQueue and @run
    @sending = true
    chunk = @outQueue
    @outQueue = ''
    body = {data: bytes-to-b64 (new TextEncoder!.encode chunk)}
    req 'POST', '/api/admin/shell/input?run=' + encodeURIComponent(@run), body
      .catch -> void  # a dropped keystroke is not worth killing the shell over
      .then ~>
        @sending = false
        @drain!

  setDimensions: (dims) ->
    return unless dims
    @rows = dims.rows
    @cols = dims.columns
    return unless @run
    req 'POST', '/api/admin/shell/resize?run=' + encodeURIComponent(@run), {rows: @rows, cols: @cols}

  close: ->
    @alive = false
    @outQueue = ''
    if @run
      req 'POST', '/api/admin/shell/kill?run=' + encodeURIComponent(@run)
      @run = null

open-worker-shell = (host, label) ->
  pty = new ShellTerminal host
  t = vscode.window.createTerminal {name: 'worker ' + (label or host), pty: pty}
  t.show!
  t

# ------------------------------ run controller ------------------------------

bc = null
diagnostics = null
me = {username: '', role: '', lang: ''}
runtime-pending = new Map!   # reqId -> resolver, for format round-trips

# Ask the runtime iframe something and await its reply (used for formatting).
runtime-request = (msg, timeout-ms) ->
  new Promise (resolve) ->
    if not bc
      resolve null
      return
    req-id = rid!
    timer = setTimeout (->
      runtime-pending.delete req-id
      resolve null), timeout-ms
    runtime-pending.set req-id, (data) ->
      clearTimeout timer
      resolve data
    bc.postMessage Object.assign {reqId: req-id}, msg

active-lc3-file = ->
  ed = vscode.window.activeTextEditor
  return null if not ed or ed.document.uri.scheme isnt 'lc3'
  ed.document.uri.path

# Where an assignment's files are. A student's copy is a top-level folder
# named after it: /hello-py/main.py. A teacher's authoring folder holds
# starter/, tests/ and solution/ and can sit anywhere: /unit1/hello-py/starter/
# main.py belongs to hello-py, whose folder is /unit1/hello-py. A teacher's file
# with none of those around it is taken to sit directly in the folder.
author-parts = <[ starter tests solution ]>
assignment-folder-of = (path) ->
  return [] unless path
  parts = path.split '/' .filter (-> it)
  return [] unless parts.length
  if me?.role is 'teacher'
    for p, i in parts when i > 0 and p in author-parts
      return parts.slice 0, i
    return parts.slice 0, parts.length - 1 if parts.length > 1
  [parts[0]]

assignment-of = (path) ->
  parts = assignment-folder-of path
  parts[parts.length - 1] or ''

due-text = (unix) ->
  return '' unless unix
  d = new Date unix * 1000
  two = (n) -> String(n).padStart 2, '0'
  d.getFullYear! + '-' + two(d.getMonth! + 1) + '-' + two(d.getDate!) +
    ' ' + two(d.getHours!) + ':' + two(d.getMinutes!)

# ------------------------------- paste policy -------------------------------
# An assignment can be set to refuse pasted code. The editor is a page, not an
# extension, so the block itself lives in index.html; all this does is tell the
# page which rule applies to the file the student is looking at now.

assignments = new Map!   # id -> { due, no_paste }
paste-policy = null      # last value published, to avoid needless posts

refresh-assignments = ->
  get-json '/api/assignments'
    .then ((j) ->
      assignments.clear!
      for a in (j.assignments or [])
        assignments.set a.id, a),
      (-> void)  # keep whatever was known
    .then -> publish-paste-policy!

publish-paste-policy = ->
  return unless bc
  # A teacher writes assignments, including by pasting one in, so the rule is
  # for students only.
  a = assignments.get assignment-of active-lc3-file!
  block = me.role isnt 'teacher' and !!(a and a.no_paste)
  return if block is paste-policy
  paste-policy := block
  bc.postMessage {t: 'paste-policy', block: block}

lang-for = (path) ->
  # The file decides how it runs. The class language only chooses which engine
  # is preloaded; the runtime loads the other on demand if a file needs it.
  return 'java' if path.endsWith '.java'
  return 'python' if path.endsWith '.py'
  me.lang or 'python'

parse-javac-diags = (text) ->
  # e.g. Greeter.java:5: error: ';' expected
  diags = []
  re = /(^|\n)([\w./$-]+\.java):(\d+): (error|warning): ([^\n]*)/g
  loop
    m = re.exec text
    break unless m?
    diags.push do
      file: m[2].split '/' .pop!
      line: parseInt m[3], 10
      col: 1
      message: m[5]
      severity: if m[4] is 'warning' then 'warning' else 'error'
  diags

# Pull the first stack frame in the student's own file out of a Java trace and
# pair it with the exception message, so a runtime error squiggles the line.
parse-java-runtime-error = (text, entry) ->
  frame-re = new RegExp '\\(' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':(\\d+)\\)'
  m = frame-re.exec text
  return [] unless m
  msg = 'runtime error'
  for line in text.split '\n'
    t = line.trim!
    if /(Exception|Error)\b/.test(t) and not t.startsWith 'at '
      msg = t.replace /^Exception in thread "\w+"\s*/, ''
      break
  [{line: parseInt(m[1], 10), col: 1, message: msg, severity: 'error'}]

# Java runs on a real JVM in the cluster. Compile + start on a runner, then
# stream its stdout to the terminal and its typed lines back to stdin, so
# Scanner/System.in actually wait for input.
run-java-cluster = (path, pty) ->
  pty.dim '[compiling and starting on the cluster]'
  req 'POST', '/api/run/exec/start', {path: path}
    .then ((resp) ->
      if not resp.ok
        return resp.json!.then ((j) -> pty.dim 'run failed: ' + (j?.detail or resp.status)),
                               (-> pty.dim 'run failed: ' + resp.status)
      resp.json!.then (r) ->
        return pty.dim 'all runners are busy right now; try again in a moment' if r.status is 'busy'
        if r.status is 'compile_error'
          pty.write (r.output or 'compile error') + '\n'
          apply-diags path, parse-javac-diags (r.output or '')
          return pty.dim '[compile error]'
        return pty.dim 'could not start the program' if r.status isnt 'running'
        apply-diags path, []   # clear old diagnostics
        pty.mode = 'exec'
        pty.execRun = r.run
        pump-java path, pty, r.run, 0, ''),
      (-> pty.dim 'could not reach a runner')

# One output poll of a running Java program, then the next, until it is done or
# the terminal moved on to something else.
pump-java = (path, pty, server-run, since, out-all) ->
  return unless pty.execRun is server-run
  req 'GET', '/api/run/exec/output?run=' + encodeURIComponent(server-run) + '&since=' + since
    .then ((o) ->
      return pty.dim '[runner error]' unless o.ok
      o.json!.then (j) ->
        all = out-all
        if j.data
          pty.write j.data
          all += j.data
        if j.done
          pty.dim '[finished, exit code ' + j.exit + ']'
          # Highlight the offending line if the program threw at runtime.
          if j.exit isnt 0
            apply-diags path, parse-java-runtime-error all, path.split '/' .pop!
          if pty.execRun is server-run
            pty.execRun = null
            pty.mode = 'idle'
          return
        pump-java path, pty, server-run, j.next, all),
      (-> pty.dim '[lost connection to the runner]')

run-command = ->
  path = active-lc3-file!
  if not path
    vscode.window.showWarningMessage 'Open a .py or .java file first.'
    return
  vscode.workspace.saveAll false .then ->
    lang = lang-for path
    {ui, pty} = get-terminal!
    ui.show!            # focus the terminal so the student can type input into it
    stop-active-run!    # end any run already in progress
    # Each run starts on a clean screen (and a clean scrollback), so what is
    # showing is this run's output and not the tail of the last one.
    pty.raw '\x1b[2J\x1b[3J\x1b[H'
    pty.raw '\x1b[1m$ run ' + (path.split '/' .pop!) + '\x1b[0m\r\n'
    if lang is 'java'
      run-java-cluster path, pty
    else
      if not bc
        pty.dim 'the Python runtime is not loaded; reload the page'
        return
      run-id = rid!
      pty.runId = run-id
      pty.mode = 'run'
      bc.postMessage {t: 'run', runId: run-id, lang: 'python', path: path}

# What the grader said, in the terminal and in one notification.
show-submit-result = (assignment, r) ->
  {ui, pty} = get-terminal!
  ui.show true
  pty.raw '\r\n\x1b[1m$ submit ' + assignment + '\x1b[0m\r\n'
  pty.dim 'grading the ' + r.graded + ' against the tests, as a student would; not recorded' if r.dry_run
  for t in r.tests
    pty.raw (if t.passed then '\x1b[32m  PASS  \x1b[0m' else '\x1b[31m  FAIL  \x1b[0m') + t.name + '\r\n'
  pty.dim 'result: ' + r.passed + ' passed, ' + r.failed + ' failed  (status: ' + r.status + ')'
  # Why a status is not ok, for the teacher's rehearsal: a student is told
  # pass/fail and nothing about the tests.
  pty.dim r.reason if r.reason
  # A late submission still counts and still reaches the teacher; saying so here
  # is the only place the student learns the deadline has passed.
  if r.late
    pty.raw '\x1b[33m  submitted after the due date (' + due-text(r.due) + ')\x1b[0m\r\n'
    vscode.window.showWarningMessage assignment + ': submitted after the due date (' +
      due-text(r.due) + '). Your teacher can see that it was late.'
  whose = if r.dry_run then 'the ' + r.graded else 'your code'
  why = if r.reason then ' ' + r.reason else ''
  if r.status is 'compile_error'
    vscode.window.showErrorMessage assignment + ': ' + whose + ' does not compile.' +
      (if r.reason then why else ' Use Run to see details.')
  else if r.status is 'timeout'
    vscode.window.showErrorMessage assignment + ': ' + whose + ' ran too long (infinite loop?).' + why
  else if r.status is 'error'
    vscode.window.showErrorMessage assignment + ': grading could not run.' + why
  else if r.failed is 0 and r.passed > 0
    vscode.window.showInformationMessage assignment + ': all ' + r.passed + ' tests passed!'
  else
    vscode.window.showWarningMessage assignment + ': ' + r.passed + ' passed, ' + r.failed + ' failed.'

# A teacher grades whichever half of the assignment they are looking at: a file
# under solution/ grades the worked answer, anything else the starter.
part-of = (path) ->
  parts = path.split '/' .filter (-> it)
  n = assignment-folder-of(path).length
  if me.role is 'teacher' and parts[n] is 'solution' then 'solution' else 'starter'

submit-command = ->
  path = active-lc3-file!
  if not path
    vscode.window.showWarningMessage 'Open a file inside an assignment folder first.'
    return
  assignment = assignment-of path
  if not assignment
    vscode.window.showWarningMessage 'Put your work in an assignment folder before submitting.'
    return
  part = part-of path
  # A teacher's authoring folder can be anywhere in their files; the gateway
  # needs its path, not only the assignment's name.
  folder = if me.role is 'teacher' then '/' + assignment-folder-of(path).join('/') else ''
  vscode.workspace.saveAll false
    .then ->
      if me.role is 'teacher'
        vscode.window.showInformationMessage 'Run "' + assignment +
          '" through grading the way a student would? ' +
          'The ' + part + ' is graded against the tests, and nothing is recorded.',
          {modal: true}, 'Run tests'
      else
        vscode.window.showWarningMessage 'Submit "' + assignment + '" for grading?',
          {modal: true}, 'Submit'
    .then (pick) ->
      return if pick isnt 'Submit' and pick isnt 'Run tests'
      vscode.window.withProgress do
        {location: vscode.ProgressLocation.Notification, title: 'Grading ' + assignment + '...'}
        ->
          # For a teacher this is the same grading path a student's submission
          # takes, over the starter they publish; it just is not recorded.
          req 'POST', '/api/submit', {assignment: assignment, part: part, folder: folder}
            .then ((resp) ->
              if not resp.ok
                return resp.json!.then ((j) ->
                  vscode.window.showErrorMessage 'Submit failed (' + resp.status + '): ' + j?.detail),
                  (-> vscode.window.showErrorMessage 'Submit failed (' + resp.status + ')')
              resp.json!.then (r) -> show-submit-result assignment, r),
              (-> vscode.window.showErrorMessage 'Could not reach the grader.')

# --------------------------------- debugger ---------------------------------
# Python debugging, in the browser. The program runs where it always runs, in
# the Pyodide worker; a trace hook there stops it on a breakpoint and reports
# the frames it is standing in. Because that worker blocks while it waits, the
# conversation cannot go over postMessage: the worker's answers come back
# through the gateway relay, and this side polls for them.
#
# The adapter is inline (no debug server process; there is nowhere to run one),
# and it speaks Debug Adapter Protocol straight to the workbench.

debug-session = null   # the one running session, if any

# The workbench identifies a file in the student's storage as an lc3: URI, and
# the protocol carries it as a string, so paths arrive as "lc3:/hello-py/x.py"
# and have to go back out the same way.
path-from-source = (p) ->
  return '' unless p
  colon = p.indexOf ':'
  if colon > 0 and /^[a-zA-Z][a-zA-Z0-9+.-]*$/.test p.slice 0, colon
    return p.slice colon + 1
  p

class Lc3PythonDebug
  ->
    @sendEmitter = new vscode.EventEmitter!
    @onDidSendMessage = @sendEmitter.event
    @runId = 'dbg' + rid!
    @seq = 1
    @breakpoints = new Map!   # path -> [line]
    @program = null
    @launched = false
    @configured = false
    @running = false
    @alive = true
    @stopped = null           # the last state the program reported
    @variables = new Map!     # variablesReference -> [variable]
    @nextRef = 1
    @evalWaiters = new Map!

  # ---- plumbing ----

  send: (msg) ->
    msg.seq = @seq++
    @sendEmitter.fire msg

  event: (event, body) -> @send {type: 'event', event: event, body: body or {}}

  respond: (request, body) ->
    @send do
      type: 'response'
      request_seq: request.seq
      success: true
      command: request.command
      body: body or {}

  fail: (request, message) ->
    @send do
      type: 'response'
      request_seq: request.seq
      success: false
      command: request.command
      message: message

  # Tell the paused program what to do next.
  command: (cmd) ->
    req 'POST', '/api/run/debug/command?run=' + encodeURIComponent(@runId), cmd

  handleMessage: (message) ->
    return unless message.type is 'request'
    try
      p = @request message
      p?.catch? (e) ~> @fail message, String (e?.message or e)
    catch e
      @fail message, String (e?.message or e)

  request: (request) ->
    switch request.command
    | 'initialize'
      @respond request, do
        supportsConfigurationDoneRequest: true
        supportsEvaluateForHovers: true
        supportsTerminateRequest: true
      @event 'initialized'
    | 'launch'
      @program = (request.arguments or {}).program or active-lc3-file!
      @launched = true
      @respond request
      @maybeStart!
    | 'setBreakpoints'
      args = request.arguments or {}
      path = path-from-source (args.source or {}).path
      lines = [b.line for b in (args.breakpoints or [])]
      @breakpoints.set path, lines
      # Breakpoints set while the program is already running still count.
      @command {cmd: 'breakpoints', breakpoints: @allBreakpoints!} if @running
      @respond request, {breakpoints: [{verified: true, line: line} for line in lines]}
    | 'configurationDone'
      @configured = true
      @respond request
      @maybeStart!
    | 'threads'
      @respond request, {threads: [{id: 1, name: 'python'}]}
    | 'stackTrace'
      frames = for f in (if @stopped then @stopped.frames else [])
        id: f.id
        name: f.name
        line: f.line
        column: 1
        source:
          name: (f.path or '').split('/').pop! or (@program or '').split('/').pop!
          path: 'lc3:' + (if f.path then @editorPath f.path else @program)
      @respond request, {stackFrames: frames, totalFrames: frames.length}
    | 'scopes'
      wanted = (request.arguments or {}).frameId
      frame = (if @stopped then @stopped.frames else []).find (f) -> f.id is wanted
      scopes = []
      if frame
        scopes.push {name: 'Locals', variablesReference: @storeVars(frame.locals), expensive: false}
        scopes.push {name: 'Globals', variablesReference: @storeVars(frame.globals), expensive: false}
      @respond request, {scopes: scopes}
    | 'variables'
      @respond request, {variables: (@variables.get (request.arguments or {}).variablesReference) or []}
    | 'continue'
      @resume {cmd: 'continue'}
      @respond request, {allThreadsContinued: true}
    | 'next'
      @resume {cmd: 'next'}
      @respond request
    | 'stepIn'
      @resume {cmd: 'stepIn'}
      @respond request
    | 'stepOut'
      @resume {cmd: 'stepOut'}
      @respond request
    | 'evaluate'
      args = request.arguments or {}
      @evaluate args.expression, args.frameId .then (value) ~>
        if value?
          @respond request, do
            result: value.value
            type: value.type
            variablesReference: @storeVars value.children
        else
          @fail request, 'not available'
    | 'disconnect', 'terminate'
      @stop!
      @respond request
    | otherwise
      @respond request

  # The program runs from a copy of its own folder, so breakpoints travel as
  # paths relative to that folder ("main.py", "shapes/circle.py"). Breakpoints
  # in files outside it belong to another program and are left behind.
  allBreakpoints: ->
    program = @program or ''
    folder = program.slice 0, program.lastIndexOf('/') + 1
    out = {}
    @breakpoints.forEach (lines, path) ->
      return if not lines.length or not path.startsWith folder
      out[path.slice folder.length] = lines
    out

  # ...and come back the same way, as a path this editor can open.
  editorPath: (rel) ->
    program = @program or ''
    (program.slice 0, program.lastIndexOf('/') + 1) + rel

  storeVars: (list) ->
    return 0 if not list or not list.length
    ref = ++@nextRef
    @variables.set ref, [{
      name: v.name
      value: v.value
      type: v.type
      variablesReference: @storeVars v.children
    } for v in list]
    ref

  # ---- the run itself ----

  maybeStart: ->
    return if not @launched or not @configured or @running
    return @exited 'no file to debug' if not @program
    return @exited 'the Python runtime is not loaded; reload the page' if not bc
    @running = true
    {ui, pty} = get-terminal!
    ui.show!
    stop-active-run!
    pty.raw '\r\n\x1b[1m$ debug ' + (@program.split '/' .pop!) + '\x1b[0m\r\n'
    # Debugging is a run: its output and its input() go to the same terminal.
    pty.runId = @runId
    pty.mode = 'run'
    bc.postMessage do
      t: 'debug'
      runId: @runId
      lang: 'python'
      path: @program
      breakpoints: @allBreakpoints!
    @poll!

  resume: (cmd) ->
    @stopped = null
    @variables.clear!
    @command cmd
    @event 'continued', {threadId: 1, allThreadsContinued: true}

  evaluate: (expression, frame-id) ->
    return Promise.resolve null if not @stopped or not expression
    req-id = rid!
    waiter = new Promise (resolve) ~>
      timer = setTimeout (~>
        @evalWaiters.delete req-id
        resolve null), 10000
      @evalWaiters.set req-id, (v) ->
        clearTimeout timer
        resolve v
    @command {cmd: 'evaluate', reqId: req-id, expression: expression, frameId: frame-id}
    waiter

  # Everything the program has to say arrives here, one long poll at a time.
  poll: ->
    return unless @alive
    req 'GET', '/api/run/debug/events?run=' + encodeURIComponent(@runId)
      .then ((resp) ~>
        return unless @alive
        return @exited 'the runtime stopped answering' unless resp.ok
        return @poll! if resp.status is 204   # nothing yet; ask again
        resp.json!
          .then ((m) ~> @onEvent m), (~> true)
          .then (keep-going) ~> @poll! unless keep-going is false),
        (~> @exited 'lost contact with the program')

  # Returns false when the program is over and there is nothing left to poll.
  onEvent: (m) ->
    if m.t is 'stopped'
      @stopped = m
      @variables.clear!
      @event 'stopped', {reason: (m.reason or 'step'), threadId: 1, allThreadsStopped: true}
    else if m.t is 'eval'
      cb = @evalWaiters.get m.reqId
      if cb
        @evalWaiters.delete m.reqId
        cb m.value
    else if m.t is 'exit'
      @exited null, m.code
      return false
    true

  exited: (message, code) ->
    return unless @alive
    @alive = false
    vscode.window.showWarningMessage 'LC3 debug: ' + message if message
    @event 'exited', {exitCode: code or 0}
    @event 'terminated'

  stop: ->
    if not @alive
      @cleanup!
      return
    @alive = false
    # A paused program takes the command and unwinds cleanly. One that is
    # running is not listening, so the runtime is torn down under it, the same
    # way Ctrl+C stops a runaway loop.
    @command {cmd: 'stop'}
    bc.postMessage {t: 'stop'} if bc
    @cleanup!

  cleanup: ->
    req 'POST', '/api/run/debug/command?run=' + encodeURIComponent(@runId) + '&end=1'
    if term-instance and term-instance.runId is @runId
      term-instance.runId = null
      term-instance.mode = 'idle'
    debug-session := null if debug-session is this

  dispose: -> @stop!

debug-command = ->
  path = active-lc3-file!
  if not path
    vscode.window.showWarningMessage 'Open a .py file to debug.'
    return
  if path.endsWith '.java'
    vscode.window.showWarningMessage 'Debugging is Python only for now. Run the Java file instead (F5).'
    return
  vscode.workspace.saveAll false .then ->
    vscode.debug.startDebugging undefined, do
      type: 'lc3-python'
      request: 'launch'
      name: path.split '/' .pop!
      program: path

# -------------------------------- diagnostics -------------------------------

apply-diags = (path, diags) ->
  folder = path.slice 0, path.lastIndexOf('/') + 1
  by-uri = new Map!
  for d in (diags or [])
    p = if d.file then folder + d.file else path
    uri = vscode.Uri.from {scheme: 'lc3', path: p}
    line = Math.max 0, (d.line or 1) - 1
    col = Math.max 0, (d.col or 1) - 1
    range = new vscode.Range line, col, line, 4096
    sev = if d.severity is 'warning'
      then vscode.DiagnosticSeverity.Warning
      else vscode.DiagnosticSeverity.Error
    list = by-uri.get(uri.toString!) or []
    list.push new vscode.Diagnostic range, (d.message or 'error'), sev
    by-uri.set uri.toString!, list
  # Always clear the run file first, then set whatever came back.
  diagnostics.set (vscode.Uri.from {scheme: 'lc3', path: path}), []
  by-uri.forEach (list, key) -> diagnostics.set (vscode.Uri.parse key), list

on-runtime-message = (ev) ->
  m = ev.data or {}
  # Program output lands in the terminal. If the student trashed it the run was
  # stopped with it, so late messages are dropped rather than resurrecting it.
  if m.t is 'out' or m.t is 'status' or m.t is 'exit'
    t = term-instance
    return unless t
    return if t.runId and m.runId and t.runId isnt m.runId   # a stale/other run
    if m.t is 'out'
      t.write m.data
    else if m.t is 'status'
      t.dim '[' + m.text + ']'
    else if m.t is 'exit'
      t.dim '[finished, exit code ' + m.code + ']'
      t.runId = null
      t.mode = 'idle'
      # A debug session ends when its program does.
      debug-session.exited null, m.code if debug-session and debug-session.runId is m.runId
    return
  if m.t is 'paste-policy-request'
    paste-policy := null   # the page has just started; tell it either way
    publish-paste-policy!
  else if m.t is 'diags'
    apply-diags m.path, m.diags
  else if m.t is 'formatted'
    cb = runtime-pending.get m.reqId
    if cb
      runtime-pending.delete m.reqId
      cb m
  else if m.t is 'ready'
    term-instance.dim 'runtime warning: ' + m.error if m.error and term-instance

# ----------------------------- admin (teacher) ------------------------------
# Native VS Code UI: a tree view of classes, students, assignments, workers, and
# submissions, with actions run through input boxes and the file-open dialog.
# Webviews are not available over plain HTTP, so nothing here uses one.

admin-tree = null

get-json = (path) ->
  req 'GET', path .then (r) ->
    throw new Error 'server returned ' + r.status unless r.ok
    r.json!

post-json = (path, body) ->
  req 'POST', path, body .then (r) ->
    r.json!.then ((j) ->
      throw new Error ((j?.detail) or ('server returned ' + r.status)) unless r.ok
      j),
      (->
        throw new Error 'server returned ' + r.status unless r.ok
        {})

admin-error = (e) -> vscode.window.showErrorMessage 'LC3: ' + (e?.message or e)

# Every command in this view ends the same way when something goes wrong, and
# none of them should take the panel down with them.
guarded = (body) -> (...args) ->
  try
    (body ...args)?.catch? admin-error
  catch e
    admin-error e

# How busy a node is, in the one line the tree has room for: the runs it is
# carrying out of the runs it accepts, then the machine's own load.
worker-summary = (w) ->
  l = w.load or {}
  return 'provisioning' if w.status is 'provisioning'
  return w.status + '  ·  no load report' unless l.reachable
  parts = [w.status, 'runs ' + (l.runs or 0) + '/' + (l.max_runs or 0)]
  parts.push 'grading ' + l.grades if l.grades
  parts.push 'shells ' + l.shells if l.shells
  avg = (l.loadavg or [])[0]
  if avg isnt undefined
    # Load is per-core on the machine reporting it; a Pi 3 has 4, the Pi 4 has 4.
    parts.push 'cpu ' + Math.round((avg / Math.max 1, (l.cpus or 1)) * 100) + '%'
  parts.push (l.mem_avail_mb or 0) + ' MB free' if l.mem_total_mb
  parts.join '  ·  '

worker-detail = (w) ->
  l = w.load or {}
  lines = ['**' + w.host + '**' + (if w.local then ' (gateway)' else ''), '', 'status: ' + w.status]
  lines.push 'note: ' + w.note if w.note
  if not l.reachable
    lines.push '', 'The runner on this node did not answer, so there is no load to show.'
    return lines.join '\n\n'
  lines.push 'interactive runs: ' + (l.runs or 0) + ' of ' + (l.max_runs or 0) +
    ' (' + (l.dispatched or 0) + ' routed from this gateway)'
  lines.push 'grading: ' + (l.grades or 0) + ' of ' + (l.max_grades or 0) +
    ' (' + (l.grading or 0) + ' sent from this gateway)'
  lines.push 'load average: ' + (l.loadavg or []).join(', ') + ' over ' + (l.cpus or 1) + ' cpus'
  lines.push 'memory: ' + (l.mem_avail_mb or 0) + ' MB free of ' + (l.mem_total_mb or 0) + ' MB'
  lines.push 'java: ' + (if l.java then 'installed' else 'missing')
  lines.push 'shell: ' + (if l.shell_available then 'available' else 'not configured on this node')
  lines.join '\n\n'

section-item = (label, ctx, icon) ->
  it = new vscode.TreeItem label, vscode.TreeItemCollapsibleState.Collapsed
  it.contextValue = ctx           # sec:classes, sec:students, ...
  it.section = ctx.split(':')[1]
  it.iconPath = new vscode.ThemeIcon icon
  it

class AdminTree
  ->
    @_emitter = new vscode.EventEmitter!
    @onDidChangeTreeData = @_emitter.event

  refresh: -> @_emitter.fire!
  getTreeItem: (e) -> e

  getChildren: (node) ->
    if not node
      return Promise.resolve [
        section-item 'Classes', 'sec:classes', 'symbol-class'
        section-item 'Students', 'sec:students', 'account'
        section-item 'Assignments', 'sec:assignments', 'book'
        section-item 'Workers', 'sec:workers', 'server-environment'
        section-item 'Recent submissions', 'sec:submissions', 'checklist'
      ]
    rows = switch node.section
    | 'classes' => get-json '/api/admin/classes' .then (j) -> [class-row c for c in (j.classes or [])]
    | 'students' => get-json '/api/admin/students' .then (j) ->
        [student-row u for u in (j.users or []) when u.role is 'student']
    | 'assignments' => get-json '/api/assignments' .then (j) ->
        [assignment-row a for a in (j.assignments or [])]
    | 'workers' => get-json '/api/admin/workers' .then (j) -> [worker-row w for w in (j.workers or [])]
    | 'submissions' => get-json '/api/admin/submissions' .then (j) ->
        [submission-row s for s in (j.submissions or []).slice 0, 50]
    | otherwise => Promise.resolve []
    rows.catch (e) -> [new vscode.TreeItem '(failed to load - ' + (e?.message or e) + ')']

class-row = (c) ->
  it = new vscode.TreeItem c.id + '  ·  ' + c.lang
  it.description = c.name + (if c.signup_open
    then '  ·  joining with ' + (c.code or '(no code)')
    else '  ·  closed to new accounts')
  it.contextValue = if c.signup_open then 'class.open' else 'class'
  it.lc3 = c
  it.iconPath = new vscode.ThemeIcon 'symbol-class'
  it.tooltip = new vscode.MarkdownString '**' + c.id + '**  ' + c.name + ' (' + c.lang + ')\n\n' +
    'join code: `' + (c.code or '(none yet)') + '`\n\n' +
    (if c.signup_open
      then 'Students can create accounts in this class right now.'
      else 'Sign-ups are closed. Open them for the lesson, then close them again.')
  it

student-row = (u) ->
  it = new vscode.TreeItem u.username
  it.description = u.class or '(no class)'
  it.contextValue = 'student'
  it.lc3 = u
  it.iconPath = new vscode.ThemeIcon 'account'
  it

assignment-row = (a) ->
  it = new vscode.TreeItem a.id
  it.description = (a.classes or []).join(', ') + '  ·  ' + a.language +
    (if a.due then '  ·  due ' + due-text a.due else '') +
    (if a.no_paste then '  ·  no paste' else '') +
    (if a.closed then '  ·  closed' else '')
  it.contextValue = 'assignment'
  it.lc3 = a
  it.iconPath = new vscode.ThemeIcon (if a.closed then 'lock' else 'book')
  it.tooltip = new vscode.MarkdownString '**' + a.id + '**  ' + (a.title or '') + '\n\n' +
    'classes: ' + ((a.classes or []).join(', ') or '(none)') + '\n\n' +
    'due: ' + (if a.due then due-text a.due else 'no due date') + '\n\n' +
    'pasting: ' + (if a.no_paste then 'blocked for students' else 'allowed')
  it

worker-row = (w) ->
  it = new vscode.TreeItem w.host + (if w.local then '  (gateway)' else '')
  it.description = worker-summary w
  it.contextValue = if w.local then 'worker.local' else 'worker'
  it.lc3 = w
  it.iconPath = new vscode.ThemeIcon (if w.status is 'up'
    then 'pass'
    else (if w.status is 'error' then 'error' else 'circle-slash'))
  it.tooltip = new vscode.MarkdownString worker-detail w
  it

submission-row = (s) ->
  it = new vscode.TreeItem s.username + ' · ' + s.assignment
  it.description = s.passed + '/' + (s.passed + s.failed) + '  (' + s.status + ')' +
    (if s.late then '  ·  late' else '')
  it.contextValue = 'submission'
  it.iconPath = new vscode.ThemeIcon (if s.failed is 0 and s.passed > 0 then 'pass' else 'warning')
  it

# What creating an assignment did. A new one is unpublished until the teacher
# says otherwise; one that already existed has had its tests and starter
# replaced, and its students keep the work they had.
created-text = (j) ->
  if j.updated
    'LC3: updated "' + j.id + '": the new tests are in effect and students keep their work' +
      (if j.closed then '. It is still unpublished.' else '; ' + j.published_to +
        ' students received files they were missing.')
  else
    'LC3: created "' + j.id + '" (unpublished). Press Publish when the class should see it.'

pick-class = (place-holder, include-none) ->
  get-json '/api/admin/classes' .then (j) ->
    items = [{label: c.id, description: c.name + ' (' + c.lang + ')'} for c in (j.classes or [])]
    items.unshift {label: '(no class)', description: '', _none: true} if include-none
    if not items.length
      vscode.window.showWarningMessage 'LC3: create a class first.'
      return undefined
    vscode.window.showQuickPick items, {placeHolder: place-holder} .then (p) ->
      return undefined unless p
      if p._none then '' else p.label

pick-classes = (place-holder) ->
  get-json '/api/admin/classes' .then (j) ->
    classes = j.classes or []
    if not classes.length
      vscode.window.showWarningMessage 'LC3: create a class first.'
      return undefined
    items = [{label: c.id, description: c.name + ' (' + c.lang + ')', lang: c.lang} for c in classes]
    vscode.window.showQuickPick items, {placeHolder: place-holder, canPickMany: true} .then (picks) ->
      return undefined if not picks or not picks.length
      langs = new Set [p.lang for p in picks]
      if langs.size > 1
        vscode.window.showErrorMessage 'LC3: an assignment can only span classes of the same language.'
        return undefined
      [p.label for p in picks]

confirm-modal = (message) ->
  vscode.window.showWarningMessage message, {modal: true}, 'Yes' .then (pick) -> pick is 'Yes'

register-admin = (context) ->
  admin-tree := new AdminTree!
  # Read-only view of a recalled submission's files (scheme lc3grade:).
  grade-docs =
    provideTextDocumentContent: (uri) ->
      parts = uri.path.replace(/^\//, '').split '/'
      assignment = parts.shift!
      user = parts.shift!
      rel = parts.join '/'
      req 'GET', '/api/admin/collected/read?assignment=' + encodeURIComponent(assignment) +
          '&user=' + encodeURIComponent(user) + '&path=' + encodeURIComponent(rel)
        .then ((r) -> if r.ok then r.text! else '// could not load ' + rel),
              (-> '// error loading ' + rel)

  context.subscriptions.push do
    vscode.workspace.registerTextDocumentContentProvider 'lc3grade', grade-docs
    vscode.window.registerTreeDataProvider 'lc3.admin', admin-tree
    vscode.commands.registerCommand 'lc3.admin.refresh', -> admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.addClass', guarded ->
      id <- vscode.window.showInputBox {prompt: 'Class id (letters, numbers, - or _)'} .then
      return unless id
      name <- vscode.window.showInputBox {prompt: 'Class name', value: id} .then
      return if name is undefined
      lang <- vscode.window.showQuickPick ['python', 'java'], {placeHolder: 'Language'} .then
      return unless lang
      <- post-json '/api/admin/classes', {id: id.trim!, name: name, lang: lang} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.deleteClass', guarded (item) ->
      id = item?.lc3?.id
      return unless id
      yes-please <- confirm-modal 'Delete class "' + id +
        '"? Its students keep their accounts but lose the class.' .then
      return unless yes-please
      <- post-json '/api/admin/classes/delete', {id: id} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.classCode', guarded (item) ->
      c = item?.lc3 or {}
      return unless c.id
      if not c.code
        vscode.window.showWarningMessage 'LC3: "' + c.id + '" has no join code yet. Use New Join Code.'
        return
      # Copying beats reading it back off a tooltip when it goes on the board.
      <- vscode.env.clipboard.writeText c.code .then
      vscode.window.showInformationMessage 'LC3: join code for "' + c.id + '" is ' + c.code +
        ' (copied). ' + (if c.signup_open
          then 'Sign-ups are open.'
          else 'Sign-ups are closed; open them before the lesson.')

    vscode.commands.registerCommand 'lc3.newClassCode', guarded (item) ->
      c = item?.lc3 or {}
      return unless c.id
      go <- (if c.code
        then confirm-modal 'Give "' + c.id + '" a new join code? The current one stops working immediately.'
        else Promise.resolve true) .then
      return unless go
      j <- post-json '/api/admin/classes/code', {id: c.id} .then
      admin-tree.refresh!
      <- vscode.env.clipboard.writeText j.code .then
      vscode.window.showInformationMessage 'LC3: new join code for "' + c.id + '" is ' + j.code + ' (copied).'

    vscode.commands.registerCommand 'lc3.toggleSignup', guarded (item) ->
      c = item?.lc3 or {}
      return unless c.id
      open = not c.signup_open
      <- post-json '/api/admin/classes/signup', {id: c.id, open: open} .then
      admin-tree.refresh!
      vscode.window.showInformationMessage (if open
        then 'LC3: "' + c.id + '" is accepting accounts with code ' + (c.code or '(none)') + '.'
        else 'LC3: "' + c.id + '" is closed to new accounts.')

    vscode.commands.registerCommand 'lc3.addStudent', guarded ->
      username <- vscode.window.showInputBox {prompt: 'Student username'} .then
      return unless username
      password <- vscode.window.showInputBox {prompt: 'Password'} .then
      return unless password
      cls <- pick-class 'Class for this student', true .then
      return if cls is undefined
      <- post-json '/api/admin/students', {username: username.trim!, password: password, class: cls} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.setStudentClass', guarded (item) ->
      username = item?.lc3?.username
      return unless username
      cls <- pick-class 'Move ' + username + ' to class', true .then
      return if cls is undefined
      <- post-json '/api/admin/students/setclass', {username: username, class: cls} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.deleteStudent', guarded (item) ->
      username = item?.lc3?.username
      return unless username
      yes-please <- confirm-modal 'Delete student "' + username + '"?' .then
      return unless yes-please
      <- post-json '/api/admin/students/delete', {username: username} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.resetPassword', guarded (item) ->
      username = item?.lc3?.username
      return unless username
      pw <- vscode.window.showInputBox {prompt: 'New password for ' + username} .then
      return unless pw
      <- post-json '/api/admin/students/setpassword', {username: username, password: pw} .then
      vscode.window.showInformationMessage 'LC3: reset password for ' + username + '.'

    vscode.commands.registerCommand 'lc3.createAssignment', guarded ->
      classes <- pick-classes 'Class(es) for this assignment (space to select more)' .then
      return unless classes
      # The folder holding starter/ and tests/, whatever file of it is open.
      active = vscode.window.activeTextEditor
      def = if active and active.document.uri.scheme is 'lc3'
        then active.document.uri.path.replace(/\/[^/]*$/, '').replace /\/(starter|tests|solution)(\/.*)?$/, ''
        else ''
      folder <- vscode.window.showInputBox {
        prompt: 'Folder in your files containing starter/ and tests/', value: def} .then
      return unless folder
      id <- vscode.window.showInputBox {prompt: 'Assignment id (blank = folder name)'} .then
      return if id is undefined
      j <- post-json '/api/admin/assignments/from-folder', {folder: folder, id: id.trim!, classes: classes} .then
      admin-tree.refresh!
      vscode.window.showInformationMessage created-text j

    vscode.commands.registerCommand 'lc3.deleteAssignment', guarded (item) ->
      id = item?.lc3?.id
      return unless id
      yes-please <- confirm-modal 'Delete assignment "' + id +
        '"? This removes it, its snapshots, and every student\'s copy.' .then
      return unless yes-please
      <- post-json '/api/admin/assignments/delete', {id: id} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.uploadAssignment', guarded ->
      classes <- pick-classes 'Class(es) for this assignment (space to select more)' .then
      return unless classes
      uris <- vscode.window.showOpenDialog {
        canSelectMany: false, openLabel: 'Upload', filters: {'Zip archives': ['zip']}} .then
      return if not uris or not uris.length
      bytes <- vscode.workspace.fs.readFile uris[0] .then
      id <- vscode.window.showInputBox {
        prompt: 'Assignment id (leave blank to use assignment.yaml in the zip)'} .then
      return if id is undefined
      j <- post-json '/api/admin/assignments/upload',
        {classes: classes, id: id.trim!, zip_b64: bytes-to-b64 bytes} .then
      vscode.window.showInformationMessage created-text j
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.publishAssignment', guarded (item) ->
      id = item?.lc3?.id
      return unless id
      j <- post-json '/api/admin/assignments/publish', {id: id} .then
      admin-tree.refresh!
      vscode.window.showInformationMessage 'LC3: published "' + id + '" to ' + j.published_to + ' students.'

    vscode.commands.registerCommand 'lc3.unpublishAssignment', guarded (item) ->
      id = item?.lc3?.id
      return unless id
      <- post-json '/api/admin/assignments/unpublish', {id: id} .then
      admin-tree.refresh!
      vscode.window.showInformationMessage 'LC3: unpublished "' + id + '" (hidden from students).'

    vscode.commands.registerCommand 'lc3.recallAssignment', guarded (item) ->
      id = item?.lc3?.id
      return unless id
      j <- post-json '/api/admin/assignments/recall', {id: id} .then
      vscode.window.showInformationMessage 'LC3: recalled ' + j.collected + ' submissions for "' + id + '".'

    # Reading the class's work, one student at a time. The score is written in
    # the school's gradebook, not here: this device keeps no grades.
    vscode.commands.registerCommand 'lc3.reviewSubmissions', guarded (item) ->
      id = item?.lc3?.id
      return unless id
      <- post-json '/api/admin/assignments/recall', {id: id} .then   # fresh snapshot
      col <- get-json '/api/admin/collected?assignment=' + encodeURIComponent(id) .then
      students = col.students or []
      if not students.length
        vscode.window.showInformationMessage 'LC3: nothing submitted yet for "' + id + '".'
        return
      subs <- get-json '/api/admin/submissions' .then
      latest = new Map!
      for s in (subs.submissions or [])
        latest.set s.username, s if s.assignment is id and not latest.has s.username
      review-next id, students, latest

    # Which classes an assignment is for. Adding one hands it to that class now;
    # dropping one takes it back, keeping a snapshot of what they had done.
    vscode.commands.registerCommand 'lc3.assignmentClasses', guarded (item) ->
      a = item?.lc3 or {}
      return unless a.id
      classes <- pick-classes 'Classes for "' + a.id + '" (space to select more)' .then
      return unless classes
      j <- post-json '/api/admin/assignments/settings', {id: a.id, classes: classes} .then
      admin-tree.refresh!
      vscode.window.showInformationMessage 'LC3: "' + a.id + '" is now for ' +
        j.classes.join(', ') + ', published to ' + j.published_to + ' new students.'

    # When an assignment is due, and whether students may paste into it.
    vscode.commands.registerCommand 'lc3.assignmentSettings', guarded (item) ->
      a = item?.lc3 or {}
      return unless a.id
      due <- vscode.window.showInputBox {
        prompt: 'Due date for "' + a.id + '" (2026-09-14 23:59, or a date on its own). Empty for none.'
        value: if a.due then due-text a.due else ''
        placeHolder: 'YYYY-MM-DD HH:MM'} .then
      return if due is undefined
      choices =
        * label: 'Pasting allowed'
          block: false
        * label: 'Block pasting from outside the editor'
          block: true
          description: 'students can still copy and paste within their own files'
      paste <- vscode.window.showQuickPick choices, {placeHolder: 'Pasting for "' + a.id + '"'} .then
      return unless paste
      settings = {id: a.id, due: due.trim!, no_paste: paste.block}
      j <- post-json '/api/admin/assignments/settings', settings .then
      admin-tree.refresh!
      vscode.window.showInformationMessage 'LC3: "' + a.id + '" is ' +
        (if j.due then 'due ' + due-text j.due else 'not due on a date') +
        (if j.no_paste then ', pasting blocked.' else ', pasting allowed.')

    vscode.commands.registerCommand 'lc3.addWorker', guarded ->
      host <- vscode.window.showInputBox {prompt: 'Raspberry Pi 3 IP address'} .then
      return unless host
      user <- vscode.window.showInputBox {prompt: 'SSH user', value: 'alarm'} .then
      return if user is undefined
      password <- vscode.window.showInputBox {prompt: 'SSH password', value: 'alarm'} .then
      return if password is undefined
      root <- vscode.window.showInputBox {prompt: 'Root password', value: 'root'} .then
      return if root is undefined
      <- post-json '/api/admin/workers',
        {host: host.trim!, user: user, password: password, root_password: root} .then
      vscode.window.showInformationMessage 'LC3: provisioning started; use Recheck in a minute.'
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.recheckWorkers', guarded ->
      <- post-json '/api/admin/workers/recheck', {} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.deleteWorker', guarded (item) ->
      host = item?.lc3?.host
      return unless host
      yes-please <- confirm-modal 'Remove worker "' + host + '"?' .then
      return unless yes-please
      <- post-json '/api/admin/workers/delete', {host: host} .then
      admin-tree.refresh!

    vscode.commands.registerCommand 'lc3.workerTerminal', guarded (item) ->
      w = item?.lc3 or {}
      return unless w.host
      if w.load and w.load.reachable and not w.load.shell_available
        vscode.window.showWarningMessage 'LC3: ' + w.host +
          ' has no shell. Set LC3_SHELL_TOKEN on that node and on the gateway.'
        return
      open-worker-shell w.host, (if w.local then 'gateway' else w.host)

    vscode.commands.registerCommand 'lc3.newAssignment', guarded ->
      lang <- vscode.window.showQuickPick ['python', 'java'],
        {placeHolder: 'Language for the new assignment'} .then
      return unless lang
      folder <- vscode.window.showInputBox {
        prompt: 'Folder name in your files (letters, numbers, - or _)'
        placeHolder: 'unit3-cart'} .then
      return unless folder
      title <- vscode.window.showInputBox {prompt: 'Title students see', value: folder} .then
      return if title is undefined
      j <- post-json '/api/admin/assignments/template',
        {folder: folder.trim!, language: lang, title: title} .then
      <- vscode.commands.executeCommand 'workbench.files.action.refreshFilesExplorer' .then
      # Open the starter so the teacher lands on the file they will edit.
      uri = vscode.Uri.from {scheme: 'lc3', path: '/' + j.folder + '/starter/' + j.entry}
      <- (vscode.workspace.openTextDocument uri
        .then ((doc) -> vscode.window.showTextDocument doc), (-> void)) .then
      vscode.window.showInformationMessage 'LC3: created "' + j.folder +
        '". Press Submit to run it the way a student would, then publish it with ' +
        'Create Assignment from Folder.'

  # Refresh the workers and submissions view periodically.
  timer = setInterval (-> admin-tree.refresh!), 15000
  context.subscriptions.push new vscode.Disposable -> clearInterval timer

# One student's work, opened read-only, then back to the picker until the
# teacher presses Escape.
# Picking a student opens their files read-only. The play button on a row
# instead copies that student's work into the teacher's own files, under
# review/, and opens it there: a real folder, so Run, input, the debugger and
# editing all work on it, for trying the case the tests did not cover.
run-button = {iconPath: new vscode.ThemeIcon('play'), tooltip: 'Copy into my files and open it to run'}

checkout-work = (id, username) ->
  j <- post-json '/api/admin/collected/checkout', {assignment: id, user: username} .then
  <- vscode.commands.executeCommand 'workbench.files.action.refreshFilesExplorer' .then
  return unless j.entry
  uri = vscode.Uri.from {scheme: 'lc3', path: j.folder + '/' + j.entry}
  <- (vscode.workspace.openTextDocument uri
    .then ((doc) -> vscode.window.showTextDocument doc, {preview: false}), (-> void)) .then
  vscode.window.showInformationMessage 'LC3: ' + username + '\'s work is in your files at ' +
    j.folder + '. Press Run to execute it; it is your copy to change.'

review-next = (id, students, latest) ->
  items = for s in students
    sub = latest.get s.username
    tests = if sub then sub.passed + '/' + (sub.passed + sub.failed) + ' tests' else 'never submitted'
    {
      label: s.username
      description: tests + (if sub and sub.late then '  ·  late' else '') +
        '  ·  ' + (if s.files.length then s.files.length + ' files' else 'no work')
      buttons: if s.files.length then [run-button] else []
      s: s
    }
  qp = vscode.window.createQuickPick!
  qp.items = items
  qp.placeholder = 'Read "' + id + '" - pick a student to read, or press the play button to run their work (Esc when done)'
  qp.onDidTriggerItemButton (ev) ->
    qp.hide!
    checkout-work id, ev.item.s.username
  qp.onDidAccept ->
    pick = qp.selectedItems[0]
    qp.hide!
    return unless pick
    opened = Promise.resolve!
    for f in pick.s.files.slice 0, 8
      let f = f
        uri = vscode.Uri.parse 'lc3grade:/' + id + '/' + pick.s.username + '/' + f
        opened := opened
          .then -> vscode.workspace.openTextDocument uri
          .then (doc) -> vscode.window.showTextDocument doc, {preview: false, preserveFocus: true}
    opened.then -> review-next id, students, latest
  qp.onDidHide ->
    qp.dispose!
  qp.show!

# --------------------------------- activate ---------------------------------

close-welcome-tabs = ->
  try
    for group in vscode.window.tabGroups.all
      for tab in group.tabs
        label = (tab.label or '').toLowerCase!
        if label.includes('welcome') or label.includes('get started') or label.includes('getting started')
          vscode.window.tabGroups.close tab
  catch e
    void   # tab API missing or nothing to close

activated = false

activate = (context) ->
  return if activated   # never wire up the run channel or commands twice
  activated := true

  context.subscriptions.push do
    vscode.workspace.registerFileSystemProvider 'lc3', (new Lc3Fs!), {isCaseSensitive: true}

  diagnostics := vscode.languages.createDiagnosticCollection 'lc3'
  context.subscriptions.push diagnostics

  # Close the "Get Started" / Welcome tab so students land straight on their
  # files, and so it never steals keyboard focus.
  close-welcome-tabs!
  setTimeout close-welcome-tabs, 1200

  # Force the dark theme (the workbench default renders light otherwise).
  theme = try
    wb = vscode.workspace.getConfiguration 'workbench'
    if wb.get('colorTheme') isnt 'Default Dark Modern'
      wb.update 'colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global
    else
      Promise.resolve!
  catch e
    Promise.resolve!   # theme not settable; ignore

  (theme or Promise.resolve!).catch (-> void)
    .then -> req 'GET', '/api/me'
    .then ((resp) -> if resp.ok then resp.json! else null), (-> null)
    .then ((who) -> me := who if who)
    .catch (-> void)
    .then -> finish-activation context

finish-activation = (context) ->
  if typeof BroadcastChannel isnt 'undefined'
    bc := new BroadcastChannel 'lc3-run'
    bc.onmessage = on-runtime-message
    context.subscriptions.push new vscode.Disposable -> bc.close!

  # Let Run build a fresh terminal after the student trashes the old one.
  context.subscriptions.push do
    vscode.window.onDidCloseTerminal (closed) -> forget-terminal closed

  # Debugging: one inline adapter, and a launch configuration the student never
  # has to write (there is no launch.json here, and no folder to keep one in).
  context.subscriptions.push do
    vscode.debug.registerDebugAdapterDescriptorFactory 'lc3-python',
      createDebugAdapterDescriptor: ->
        debug-session := new Lc3PythonDebug!
        new vscode.DebugAdapterInlineImplementation debug-session
    vscode.debug.registerDebugConfigurationProvider 'lc3-python',
      resolveDebugConfiguration: (folder, config) ->
        if not config.type
          config.type = 'lc3-python'
          config.request = 'launch'
          config.name = 'Debug'
        config.program = active-lc3-file! unless config.program
        config

  # Keep the page's paste rule in step with the file being looked at. Opening a
  # file re-reads the list rather than trusting the cached one, so a rule the
  # teacher changes mid-lesson applies at the next file the student opens.
  context.subscriptions.push do
    vscode.window.onDidChangeActiveTextEditor -> refresh-assignments!
  refresh-assignments!
  policy-timer = setInterval refresh-assignments, 60000
  context.subscriptions.push new vscode.Disposable -> clearInterval policy-timer

  context.subscriptions.push do
    vscode.commands.registerCommand 'lc3.run', run-command
    vscode.commands.registerCommand 'lc3.debug', debug-command
    vscode.commands.registerCommand 'lc3.submit', submit-command
    vscode.commands.registerCommand 'lc3.format', ->
      ed = vscode.window.activeTextEditor
      if not ed or ed.document.uri.scheme isnt 'lc3'
        vscode.window.showWarningMessage 'Open a .py or .java file to format.'
        return
      vscode.commands.executeCommand 'editor.action.formatDocument'
    vscode.commands.registerCommand 'lc3.refresh', ->
      vscode.commands.executeCommand 'workbench.files.action.refreshFilesExplorer'
    vscode.commands.registerCommand 'lc3.logout', ->
      req 'POST', '/api/logout' .then ->
        vscode.window.showInformationMessage 'Logged out. Reload the page to sign in again.'
    vscode.commands.registerCommand 'lc3.changePassword', change-password-command

  # Format Document (Shift+Alt+F): Python with black, Java with prettier, both
  # in the browser via the runtime iframe.
  formatter = (lang) ->
    provideDocumentFormattingEdits: (doc) ->
      src = doc.getText!
      runtime-request {t: 'format', lang: lang, path: doc.uri.path, text: src}, 30000
        .then (res) ->
          return [] if not res or res.text is null or res.text is undefined or res.text is src
          full = new vscode.Range doc.positionAt(0), doc.positionAt(src.length)
          [vscode.TextEdit.replace full, res.text]
  context.subscriptions.push do
    vscode.languages.registerDocumentFormattingEditProvider {scheme: 'lc3', language: 'python'}, formatter 'python'
    vscode.languages.registerDocumentFormattingEditProvider {scheme: 'lc3', language: 'java'}, formatter 'java'

  # Browser syntax check as the student saves: Python via Pyodide, Java via the
  # bundled JS parser. Both run in the hidden runtime iframe, no cluster load.
  context.subscriptions.push do
    vscode.workspace.onDidSaveTextDocument (doc) ->
      return if doc.uri.scheme isnt 'lc3' or not bc
      if doc.uri.path.endsWith '.py'
        bc.postMessage {t: 'check', lang: 'python', path: doc.uri.path}
      else if doc.uri.path.endsWith '.java'
        bc.postMessage {t: 'check', lang: 'java', path: doc.uri.path}

  # status bar: identity + run/debug/submit/format, plus admin for teachers.
  id-item = vscode.window.createStatusBarItem vscode.StatusBarAlignment.Left, 100
  id-item.text = '$(account) ' + (me.username or '')
  id-item.tooltip = if me.class then 'Class: ' + me.class else 'Logged in to LC3'
  id-item.show!
  run-item = vscode.window.createStatusBarItem vscode.StatusBarAlignment.Left, 99
  run-item.text = '$(play) Run'
  run-item.command = 'lc3.run'
  run-item.tooltip = 'Run the open file in the terminal (F5)'
  run-item.show!
  dbg-item = vscode.window.createStatusBarItem vscode.StatusBarAlignment.Left, 98.5
  dbg-item.text = '$(debug-alt) Debug'
  dbg-item.command = 'lc3.debug'
  dbg-item.tooltip = 'Debug the open Python file: breakpoints, step, variables'
  dbg-item.show!
  sub-item = vscode.window.createStatusBarItem vscode.StatusBarAlignment.Left, 98
  sub-item.text = '$(rocket) Submit'
  sub-item.command = 'lc3.submit'
  sub-item.tooltip = 'Submit this assignment for grading'
  sub-item.show!
  fmt-item = vscode.window.createStatusBarItem vscode.StatusBarAlignment.Left, 96
  fmt-item.text = '$(list-flat) Format'
  fmt-item.command = 'lc3.format'
  fmt-item.tooltip = 'Format the open file (black / prettier)'
  fmt-item.show!
  context.subscriptions.push id-item, run-item, dbg-item, sub-item, fmt-item

  if me.role is 'teacher'
    # Reveal the Class Management view container and wire up its actions.
    vscode.commands.executeCommand 'setContext', 'lc3.isTeacher', true .then ->
      register-admin context
      admin-item = vscode.window.createStatusBarItem vscode.StatusBarAlignment.Left, 97
      admin-item.text = '$(mortar-board) Class Management'
      admin-item.command = 'lc3.admin.focus'
      admin-item.tooltip = 'Open the Class Management panel'
      admin-item.show!
      context.subscriptions.push admin-item

change-password-command = ->
  current <- vscode.window.showInputBox {prompt: 'Current password', password: true} .then
  return unless current
  next <- vscode.window.showInputBox {
    prompt: 'New password (at least 8 characters)'
    password: true
    validateInput: (v) -> if v and v.length >= 8 then null else 'Use at least 8 characters.'} .then
  return unless next
  confirm <- vscode.window.showInputBox {prompt: 'Retype the new password', password: true} .then
  return if confirm is null or confirm is undefined
  if confirm isnt next
    vscode.window.showErrorMessage 'The two new passwords do not match.'
    return
  req 'POST', '/api/account/password', {current: current, new: next}
    .then ((resp) ->
      if resp.ok
        return vscode.window.showInformationMessage 'LC3: password changed. Other sessions were signed out.'
      resp.json!.then ((j) -> vscode.window.showErrorMessage 'LC3: ' + (j?.detail or 'Password change failed')),
                      (-> vscode.window.showErrorMessage 'LC3: Password change failed')),
      (-> vscode.window.showErrorMessage 'Could not reach the server.')

module.exports = {activate}
