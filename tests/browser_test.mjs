// Browser end-to-end test for the single-page app. Logs in on the overlay,
// waits for the trimmed VS Code workbench to boot on the same URL, confirms the
// student's files load, drives the hidden runtime over the same BroadcastChannel
// the extension uses (so real Pyodide output is exercised), and checks that the
// LC3 extension activated. Uses system Chrome via puppeteer-core.
//
//   npm i puppeteer-core          # anywhere node will resolve it from
//   node tests/browser_test.mjs http://<gateway>
//
// PUPPETEER_CORE overrides where puppeteer-core is loaded from, and CHROME
// which browser binary it drives.
import { readFileSync, existsSync } from 'node:fs';

const puppeteer = await (async () => {
  const tried = [];
  for (const spec of [process.env.PUPPETEER_CORE, 'puppeteer-core', 'puppeteer']) {
    if (!spec) continue;
    try { return (await import(spec)).default; } catch (e) { tried.push(spec); }
  }
  console.error('could not load puppeteer-core (tried: ' + tried.join(', ') + ').\n' +
    'Install it with "npm i puppeteer-core", or point PUPPETEER_CORE at a copy.');
  process.exit(2);
})();

// System Chrome, wherever this machine keeps it.
function findChrome() {
  const candidates = [process.env.CHROME,
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const p of candidates) if (p && existsSync(p)) return p;
  console.error('no Chrome found. Install one, or point CHROME at the binary.');
  process.exit(2);
}

const BASE = process.argv[2] || process.env.LC3_BASE;
if (!BASE) {
  console.error('usage: node tests/browser_test.mjs <gateway-url>   (or set LC3_BASE)');
  process.exit(2);
}
let pass = 0, fail = 0;
const ok = (m) => { console.log('  ok   - ' + m); pass++; };
const bad = (m) => { console.log('  FAIL - ' + m); fail++; };

// Opening the command palette headlessly is occasionally missed; retry it.
// The shortcut goes to whatever holds focus, and after a terminal or an editor
// has taken it the workbench sometimes does not see the chord at all, so click
// the workbench first and give a loaded machine enough attempts to get there.
async function paletteRun(pg, cmd) {
  for (let a = 0; a < 10; a++) {
    if (a > 0) {
      await pg.evaluate(() => {
        const wb = document.querySelector('.monaco-workbench');
        if (wb) wb.focus();
      });
      await pg.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 300));
    }
    await pg.keyboard.down('Control'); await pg.keyboard.down('Shift');
    await pg.keyboard.press('KeyP');
    await pg.keyboard.up('Shift'); await pg.keyboard.up('Control');
    try { await pg.waitForSelector('.quick-input-widget', { timeout: 4000 }); }
    catch (e) { await new Promise(r => setTimeout(r, 600)); continue; }
    await new Promise(r => setTimeout(r, 400));
    await pg.keyboard.type(cmd);
    await new Promise(r => setTimeout(r, 700));
    await pg.keyboard.press('Enter');
    return;
  }
  throw new Error('could not open command palette for: ' + cmd);
}

// A fresh install seeds only the teacher, so create the classes, students, and
// assignments this suite needs by driving the teacher API directly.
async function bootstrap() {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'lc3teach' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const post = (p, b) => fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(b) });
  await post('/api/admin/classes', { id: 'cp3', name: 'CP3 Python', lang: 'python' });
  await post('/api/admin/classes', { id: 'apcsa', name: 'AP CS A', lang: 'java' });
  await post('/api/admin/classes', { id: 'solo', name: 'Solo Java', lang: 'java' });
  await post('/api/admin/students', { username: 'demo', password: 'demo', class: 'cp3' });
  await post('/api/admin/students', { username: 'sj', password: 'sj', class: 'apcsa' });
  // 'je' is in a class with no assignments, so its home is empty: a Java Run
  // compiles only the file under test, not stray files from other assignments.
  await post('/api/admin/students', { username: 'je', password: 'je', class: 'solo' });
  const zip = (rel) => readFileSync(new URL(rel, import.meta.url)).toString('base64');
  await post('/api/admin/assignments/upload', { class: 'cp3', zip_b64: zip('../examples/hello-py.zip') });
  await post('/api/admin/assignments/upload', { class: 'apcsa', zip_b64: zip('../examples/hello-java.zip') });
}
await bootstrap();

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  acceptInsecureCerts: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // --- login overlay on the single page ---
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  try {
    await page.waitForSelector('#u', { timeout: 15000 });
    ok('login overlay shown on the app URL (no separate page)');
  } catch (e) { bad('login overlay missing: ' + e.message); }
  await page.type('#u', 'demo');
  await page.type('#p', 'demo');
  await page.click('button[type=submit]');

  // --- workbench boots on the same page ---
  try {
    await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
    ok('trimmed VS Code workbench renders after login');
  } catch (e) { bad('workbench did not render: ' + e.message); }

  try {
    await page.waitForFunction(
      () => /hello-py/i.test(document.body.innerText),
      { timeout: 30000 });
    ok('student files appear in the explorer');
  } catch (e) { bad('assignment folders not visible: ' + e.message); }

  // --- activity bar trimmed to the classroom essentials ---
  try {
    await page.waitForFunction(() => {
      const items = [...document.querySelectorAll('.activitybar .action-item')];
      const shown = (label) => items.some((li) => {
        const a = li.querySelector('[aria-label]');
        return a && a.getAttribute('aria-label').startsWith(label) && li.offsetParent !== null;
      });
      const gone = (label) => !items.some((li) => {
        const a = li.querySelector('[aria-label]');
        return a && a.getAttribute('aria-label').startsWith(label) && li.offsetParent !== null;
      });
      return shown('Explorer') && gone('Source Control') && gone('Run and Debug') && gone('Extensions') && gone('Search');
    }, { timeout: 15000 });
    ok('activity bar trimmed (Explorer only; no SCM/Debug/Extensions/Search)');
  } catch (e) { bad('activity bar not trimmed: ' + e.message); }

  // --- hidden runtime iframe present, only the python engine ---
  const hasRuntime = page.frames().some(f => f.url().includes('/runtime/'));
  if (hasRuntime) ok('hidden runtime iframe is mounted'); else bad('runtime iframe not found');
  const runtimeLangOk = page.frames().some(f => f.url().includes('/runtime/') && f.url().includes('lang=python'));
  if (runtimeLangOk) ok('runtime loaded the single class language (python)'); else bad('runtime lang not python');

  // --- exercise the run path over the shared BroadcastChannel ---
  await page.evaluate(async () => {
    await fetch('/api/fs/mkdir?path=/scratch', { method: 'POST', credentials: 'same-origin' });
    await fetch('/api/fs/write?path=/scratch/run_demo.py', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: 'name = input()\nprint("RUN_OUTPUT_" + str(6*7) + "_" + name)',
    });
    window.__msgs = [];
    window.__bc = new BroadcastChannel('lc3-run');
    window.__bc.onmessage = (e) => window.__msgs.push(e.data);
  });
  // send a stdin line the program will read (proves the relay), then run
  await page.evaluate(async () => {
    await fetch('/api/run/stdin?run=btest', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' }, body: 'Ada',
    });
    window.__bc.postMessage({ t: 'run', runId: 'btest', lang: 'python', path: '/scratch/run_demo.py' });
  });
  try {
    await page.waitForFunction(
      () => (window.__msgs || []).some(m => m.t === 'out' && String(m.data).includes('RUN_OUTPUT_42_Ada')),
      { timeout: 90000 });
    ok('Python runs in the runtime and reads stdin (output + input relay)');
  } catch (e) {
    const msgs = await page.evaluate(() => JSON.stringify(window.__msgs || []));
    bad('python run/stdin output missing. messages: ' + msgs);
  }
  try {
    await page.waitForFunction(
      () => (window.__msgs || []).some(m => m.t === 'exit'),
      { timeout: 10000 });
    ok('run reports completion (exit)');
  } catch (e) { bad('no exit message'); }

  // --- freeze regression: input() blocks in the worker, not the tab ---
  try {
    await page.evaluate(async () => {
      await fetch('/api/fs/write?path=/inp.py', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' }, body: 'n=input()\nprint("GOT_"+n)' });
      window.__im = []; window.__ibc = new BroadcastChannel('lc3-run');
      window.__ibc.onmessage = (e) => window.__im.push(e.data);
      window.__ibc.postMessage({ t: 'run', runId: 'frz', lang: 'python', path: '/inp.py' });
    });
    await new Promise(r => setTimeout(r, 4000)); // now blocked on input()
    const t0 = Date.now();
    const r = await page.evaluate(() => 1 + 1);
    const dt = Date.now() - t0;
    const waiting = !(await page.evaluate(() => window.__im.some(m => m.t === 'exit')));
    if (r === 2 && dt < 3000 && waiting) ok('input() blocks off the main thread (tab stays responsive)');
    else bad('tab froze on input() (evaluate ' + dt + 'ms, waiting=' + waiting + ')');
    await page.evaluate(async () => { await fetch('/api/run/stdin?run=frz', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream' }, body: 'Zed' }); });
    await page.waitForFunction(() => window.__im.some(m => m.t === 'out' && String(m.data).includes('GOT_Zed')), { timeout: 20000 });
    ok('input delivered from the terminal resumes the program');
  } catch (e) { bad('freeze regression: ' + e.message); }

  // --- extension activated (its status bar items are present) ---
  try {
    await page.waitForFunction(
      () => /Submit/.test(document.querySelector('.statusbar')?.innerText || ''),
      { timeout: 20000 });
    ok('LC3 extension activated (Run/Submit in the status bar)');
  } catch (e) { bad('extension status bar items missing: ' + e.message); }

  // --- real Run command: open a file -> extension -> terminal shows output ---
  // Use a top-level file so no folder needs expanding (headless list clicks do
  // not reliably toggle folders).
  try {
    await page.evaluate(async () => {
      await fetch('/api/fs/write?path=/rundemo.py', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: 'print("TERMINAL_" + str(7*6))',
      });
    });
  } catch (e) {}
  try {
    const findRow = async (match) => (await page.evaluateHandle((t) =>
      [...document.querySelectorAll('.monaco-list-row')].find(r => r.innerText.trim() === t), match)).asElement();
    // Refresh the explorer so the new top-level file appears.
    await paletteRun(page, 'LC3: Refresh Files');
    let row = null;
    for (let i = 0; i < 20 && !row; i++) { row = await findRow('rundemo.py'); if (!row) await new Promise(r => setTimeout(r, 600)); }
    if (!row) throw new Error('rundemo.py did not appear in the explorer');
    await row.click(); await new Promise(r => setTimeout(r, 400));
    await page.keyboard.press('Enter'); // open the selected file
    await new Promise(r => setTimeout(r, 1200));
    await paletteRun(page, 'LC3: Run Program');
    await page.waitForFunction(
      () => /TERMINAL_42/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')),
      { timeout: 60000 });
    ok('Run command runs the file and shows output in the integrated terminal');
    // The header is written before the workbench has opened the pseudoterminal,
    // so on the very first Run it is the part that goes missing.
    const firstRun = await page.evaluate(() =>
      [...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' '));
    if (/\$ run rundemo\.py/.test(firstRun)) ok('the first Run shows its whole header, not just the output');
    else bad('the first Run dropped its "$ run rundemo.py" header');
  } catch (e) { bad('terminal run failed: ' + e.message); }

  // --- trashing the terminal must not disable Run ---
  try {
    await paletteRun(page, 'Terminal: Kill the Active Terminal Instance');
    await new Promise(r => setTimeout(r, 2500));
    await paletteRun(page, 'LC3: Run Program');
    await page.waitForFunction(
      () => /TERMINAL_42/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')),
      { timeout: 60000 });
    ok('Run builds a new terminal after the old one is trashed');
  } catch (e) { bad('Run did not recover from a trashed terminal: ' + e.message); }

  // --- Python interactive input via the terminal (prompt + typed input) ---
  try {
    const termText = () => page.evaluate(() =>
      [...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' '));
    const findRow = async (match) => (await page.evaluateHandle((t) =>
      [...document.querySelectorAll('.monaco-list-row')].find(r => r.innerText.trim() === t), match)).asElement();
    await page.evaluate(async () => {
      await fetch('/api/fs/write?path=/in2.py', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream' }, body: "n=input('Name? ')\nprint('HI_'+n)" });
    });
    await paletteRun(page, 'LC3: Refresh Files');
    let row = null;
    for (let i = 0; i < 20 && !row; i++) { row = await findRow('in2.py'); if (!row) await new Promise(r => setTimeout(r, 600)); }
    if (!row) throw new Error('in2.py did not appear');
    await row.click(); await new Promise(r => setTimeout(r, 400));
    await page.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 1200));
    await paletteRun(page, 'LC3: Run Program');
    // Prompt must show up front and the program must be blocking (not exited).
    await page.waitForFunction(() => /Name\?/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')), { timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    const t = await termText();
    if (/Name\?/.test(t) && !/HI_/.test(t)) ok('input() shows the prompt and waits');
    else bad('prompt/wait wrong: ' + t.slice(-100));
    // Type into the terminal; the program must accept it and continue.
    await page.keyboard.type('Bob'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /HI_Bob/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')), { timeout: 20000 });
    ok('typed terminal input reaches Python input()');
    // Regression: keystrokes typed while idle (before the next run) must not
    // linger in the line buffer and get swallowed by the program's input().
    await page.keyboard.type('STALE'); // typed while idle; must be discarded
    await new Promise(r => setTimeout(r, 300));
    await paletteRun(page, 'LC3: Run Program');
    await page.waitForFunction(() => { const rows = [...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' '); return (rows.match(/Name\?/g) || []).length >= 2; }, { timeout: 60000 });
    await page.keyboard.type('Zoe'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => /HI_Zoe/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')), { timeout: 20000 });
    const t2 = await termText();
    if (/HI_STALEZoe/.test(t2)) bad('stale pre-run input leaked into input(): ' + t2.slice(-120));
    else ok('input typed before Run is discarded, not fed to input()');
  } catch (e) { bad('python terminal input failed: ' + e.message); }

  // --- Python formatting (black, in the browser, offline) ---
  try {
    const fmt = await page.evaluate(() => new Promise((resolve) => {
      const bc = new BroadcastChannel('lc3-run'); const reqId = 'pf' + Math.random();
      bc.onmessage = (e) => { if (e.data && e.data.t === 'formatted' && e.data.reqId === reqId) resolve(e.data.text); };
      bc.postMessage({ t: 'format', lang: 'python', reqId, text: 'x=1\ndef  f( a,b ):\n  return a+b\n' });
      setTimeout(() => resolve(null), 60000);
    }));
    if (fmt && /def f\(a, b\)/.test(fmt)) ok('Python formats with black in the browser');
    else bad('python format failed: ' + JSON.stringify(fmt));
  } catch (e) { bad('python format error: ' + e.message); }

  // --- java student: interactive run on the cluster JVM, waiting for input ---
  const jctx = await (browser.createBrowserContext
    ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const jpage = await jctx.newPage(); jpage.setDefaultTimeout(30000);
  await jpage.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await jpage.waitForSelector('#u', { timeout: 15000 });
  await jpage.type('#u', 'je'); await jpage.type('#p', 'je'); await jpage.click('button[type=submit]');
  await jpage.waitForSelector('.monaco-workbench', { timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  // Java executes on the cluster, but the browser mounts a lightweight Java
  // syntax checker (the runtime iframe with lang=java).
  const javaChecker = jpage.frames().some(f => f.url().includes('/runtime/') && f.url().includes('lang=java'));
  if (javaChecker) ok('java student loads the browser Java syntax checker'); else bad('java syntax-check runtime not mounted');
  try {
    await jpage.evaluate(async () => {
      await fetch('/api/fs/write?path=/Echo.java', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' },
        body: 'import java.util.Scanner;\npublic class Echo {\n  public static void main(String[] a){\n    Scanner s=new Scanner(System.in);\n    System.out.print("name? ");\n    System.out.println("HELLO_"+s.nextLine());\n  }\n}',
      });
    });
    const termText = () => jpage.evaluate(() =>
      [...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' '));
    const findRow = async (t) => (await jpage.evaluateHandle((n) =>
      [...document.querySelectorAll('.monaco-list-row')].find(r => r.innerText.trim() === n), t)).asElement();
    // refresh explorer, open Echo.java (top-level)
    await paletteRun(jpage, 'LC3: Refresh Files');
    let row = null;
    for (let i = 0; i < 20 && !row; i++) { row = await findRow('Echo.java'); if (!row) await new Promise(r => setTimeout(r, 600)); }
    if (!row) throw new Error('Echo.java did not appear');
    await row.click(); await new Promise(r => setTimeout(r, 400));
    await jpage.keyboard.press('Enter'); await new Promise(r => setTimeout(r, 1200));
    await paletteRun(jpage, 'LC3: Run Program');
    // The terminal should show the prompt and then WAIT (no HELLO yet).
    await jpage.waitForFunction(() => /name\?/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')), { timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    const waiting = await termText();
    if (/name\?/.test(waiting) && !/HELLO_/.test(waiting)) ok('Java prints the prompt and waits for input');
    else bad('java did not wait for input: ' + waiting.slice(-120));
    // Type input into the terminal; the program should resume.
    await jpage.keyboard.type('World'); await jpage.keyboard.press('Enter');
    await jpage.waitForFunction(() => /HELLO_World/.test([...document.querySelectorAll('.xterm-rows')].map(x => x.innerText).join(' ')), { timeout: 30000 });
    ok('typing input resumes the Java program (interactive stdin)');
  } catch (e) { bad('interactive java run failed: ' + e.message); }

  // --- Java formatting (prettier-plugin-java, in the browser) ---
  try {
    const jf = await jpage.evaluate(() => new Promise((resolve) => {
      const bc = new BroadcastChannel('lc3-run'); const reqId = 'jf' + Math.random();
      bc.onmessage = (e) => { if (e.data && e.data.t === 'formatted' && e.data.reqId === reqId) resolve(e.data.text); };
      bc.postMessage({ t: 'format', lang: 'java', reqId, text: 'public class A{public static void main(String[] a){int x=1;System.out.println(x);}}' });
      setTimeout(() => resolve(null), 60000);
    }));
    if (jf && jf.split('\n').length > 3 && /public class A/.test(jf)) ok('Java formats with prettier in the browser');
    else bad('java format failed: ' + JSON.stringify(jf));
  } catch (e) { bad('java format error: ' + e.message); }

  // --- teacher: the native Class Management tree loads ---
  // A fresh context: the default one is still signed in as the student.
  const tctx = await (browser.createBrowserContext
    ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const tpage = await tctx.newPage();
  tpage.setDefaultTimeout(30000);
  await tpage.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await tpage.waitForSelector('#u', { timeout: 15000 });
  await tpage.type('#u', 'teacher'); await tpage.type('#p', 'lc3teach');
  await tpage.click('button[type=submit]');
  await tpage.waitForSelector('.monaco-workbench', { timeout: 60000 });
  try {
    // open the Class Management panel by clicking its status bar entry
    await tpage.waitForFunction(() => /Class Management/.test(document.querySelector('.statusbar')?.innerText || ''), { timeout: 20000 });
    ok('teacher sees the Class Management entry');
    const clicked = await tpage.evaluate(() => {
      const item = [...document.querySelectorAll('.statusbar .statusbar-item')]
        .find(el => /Class Management/.test(el.innerText));
      if (item) { (item.querySelector('a') || item).click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('status bar Class Management button not found');
    await tpage.waitForFunction(
      () => { const t = document.body.innerText; return /Classes/.test(t) && /Students/.test(t) && /Workers/.test(t); },
      { timeout: 20000 });
    ok('Class Management tree shows classes, students, and workers');
  } catch (e) { bad('native admin tree did not load: ' + e.message); }
  // Teacher gets the Python runtime too (to author and test assignments).
  const teacherHasPy = tpage.frames().some(f => f.url().includes('/runtime/') && f.url().includes('lang=python'));
  if (teacherHasPy) ok('teacher gets the Python runtime (Java via cluster)');
  else bad('teacher missing the Python runtime');

  // --- worker load, and the shell if this deployment has one configured ---
  try {
    const workers = await tpage.evaluate(async () => {
      const r = await fetch('/api/admin/workers', { credentials: 'same-origin' });
      return r.json();
    });
    const load = (workers.workers[0] || {}).load || {};
    if (load.reachable && typeof load.max_runs === 'number') ok('workers report their load to the admin view');
    else bad('no load report from the first worker');

    if (!workers.shell) {
      console.log('  skip - worker shell (LC3_SHELL_TOKEN is not set on this deployment)');
    } else {
      const host = workers.workers[0].host;
      const started = await tpage.evaluate(async (h) => {
        const r = await fetch('/api/admin/shell/start', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: h, rows: 24, cols: 80 }),
        });
        return r.json();
      }, host);
      if (started.status !== 'running') throw new Error('shell did not start: ' + JSON.stringify(started));
      // Typed characters must reach the pty in the order they were typed, so
      // the relay has to send them one request at a time.
      const typed = 'echo LC3-ORDER-abcdefghijklmnopqrstuvwxyz\n';
      const saw = await tpage.evaluate(async (run, text) => {
        const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
        for (const ch of text) {
          await fetch('/api/admin/shell/input?run=' + run, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: b64(ch) }),
          });
        }
        let since = 0, all = '';
        for (let i = 0; i < 20; i++) {
          const r = await fetch('/api/admin/shell/output?run=' + run + '&since=' + since,
            { credentials: 'same-origin' });
          const j = await r.json();
          all += atob(j.data || '');
          since = j.next;
          if (/LC3-ORDER-abcdefghijklmnopqrstuvwxyz/.test(all)) return true;
          if (j.done) break;
        }
        return all;
      }, started.run, typed);
      if (saw === true) ok('the worker shell runs what was typed, in order');
      else bad('the worker shell scrambled or dropped input: ' + String(saw).slice(-160));
      await tpage.evaluate((run) => fetch('/api/admin/shell/kill?run=' + run,
        { method: 'POST', credentials: 'same-origin' }), started.run);
    }
  } catch (e) { bad('worker load/shell check failed: ' + e.message); }

  // --- a student creates their own account with the class code ---
  // Its own context, because this one starts signed out like a student's would.
  try {
    const code = await tpage.evaluate(async () => {
      await fetch('/api/admin/classes/code', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'cp3' }) });
      await fetch('/api/admin/classes/signup', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'cp3', open: true }) });
      const r = await fetch('/api/admin/classes', { credentials: 'same-origin' });
      const j = await r.json();
      return (j.classes.find(c => c.id === 'cp3') || {}).code;
    });
    if (!code) throw new Error('the class was given no join code');
    ok('the teacher can issue a join code and open sign-ups');

    const sctx = await (browser.createBrowserContext
      ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
    const spage = await sctx.newPage();
    await spage.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await spage.waitForSelector('#tosignup', { timeout: 20000 });
    await spage.click('#tosignup');
    await spage.waitForSelector('#sf', { timeout: 10000 });
    ok('the login page offers Create an account');

    // A wrong code must not get in, and must say so on the form.
    await spage.type('#c', 'ZZZZ-ZZZZ');
    await spage.type('#su', 'joiner' + Date.now().toString(36));
    await spage.type('#sp', 'pw123456');
    await spage.click('#sf button[type=submit]');
    await new Promise(r => setTimeout(r, 2500));
    const refused = await spage.evaluate(() => document.getElementById('se').textContent);
    if (/not accepting/.test(refused)) ok('a wrong class code is refused on the form');
    else bad('wrong code was not refused: ' + refused);

    // The real code, typed the way a student would read it off a board.
    await spage.evaluate(() => { document.getElementById('c').value = ''; });
    await spage.click('#c');
    await spage.type('#c', code.toLowerCase().replace('-', ''));
    await spage.click('#sf button[type=submit]');
    await spage.waitForSelector('.monaco-workbench', { timeout: 90000 });
    ok('the class code creates the account and signs the student straight in');
    await new Promise(r => setTimeout(r, 8000));
    const seen = await spage.evaluate(() => document.body.innerText);
    if (/hello-py/.test(seen)) ok('the new account already has its class assignment');
    else bad('the new account has no assignment in the explorer');
    await sctx.close();
  } catch (e) { bad('sign-up with a class code failed: ' + e.message); }

} catch (e) {
  bad('unexpected: ' + e.message);
} finally {
  await browser.close();
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail === 0 ? 0 : 1);
