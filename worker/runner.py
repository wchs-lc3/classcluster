"""LC3 grading runner: small HTTP service that executes one submission at a
time inside a bwrap + systemd-run sandbox and returns per-test pass/fail.

Runs as root (systemd service) on every node that grades: each Pi 3 worker
and the Pi 4 gateway (local fallback, bound to 127.0.0.1). Standard library
only; no third-party imports.

POST /grade
  {"language": "python"|"java",
   "files": {relpath: b64}, "tests": {relpath: b64},
   "timeout_sec": int, "mem_mb": int}
returns
  {"status": "ok"|"compile_error"|"timeout"|"error",
   "tests": [{"name": str, "passed": bool}]}

Student stdout/stderr never leave this process; only the parsed result file
is read back.
"""

import base64
import fcntl
import hmac
import json
import os
import pty
import shutil
import signal
import struct
import subprocess
import termios
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

def env_int(name, default):
    try:
        return int(str(os.environ.get(name, "")).strip())
    except ValueError:
        return default


def env_str(name, default):
    v = os.environ.get(name, "")
    v = v.strip() if isinstance(v, str) else ""
    return v if v else default


def env_flag(name, default):
    v = str(os.environ.get(name, "")).strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return default


# Every knob below is an environment variable so the same file runs unchanged
# on the Arch gateway (systemd present) and inside a balenaOS container, where
# the fleet/device variables in the balena dashboard are the only way to tune a
# worker.
HERE = os.path.dirname(os.path.abspath(__file__))
PYHARNESS = os.path.join(HERE, "lc3_pyharness.py")

JOBS_DIR = env_str("LC3_JOBS_DIR", "/run/lc3-jobs")  # a tmpfs
JAVA_LIBS = env_str("LC3_JAVA_LIBS", "/opt/lc3/java")
BIND = env_str("LC3_RUNNER_BIND", "0.0.0.0")
PORT = env_int("LC3_RUNNER_PORT", 9500)
MAX_TIMEOUT = env_int("LC3_MAX_TIMEOUT", 90)

PYTHON_BIN = env_str("LC3_PYTHON", "python")
SANDBOX_PATH = env_str("LC3_SANDBOX_PATH", "/usr/bin:/usr/lib/jvm/default/bin")
# Extra read-only host paths to expose in the sandbox, colon separated. The
# JDK and the grading jars live under paths already bound; this is for images
# that put them somewhere else.
SANDBOX_ROBINDS = [p for p in os.environ.get("LC3_SANDBOX_ROBINDS", "").split(":") if p]

MEM_MIN_MB = env_int("LC3_MEM_MIN_MB", 64)
MEM_MAX_MB = env_int("LC3_MEM_MAX_MB", 512)
CPU_QUOTA = env_str("LC3_CPU_QUOTA", "200%")
TASKS_MAX = env_int("LC3_TASKS_MAX", 64)

GRADE_JAVA_XMX_MB = env_int("LC3_GRADE_JAVA_XMX_MB", 200)
RUN_JAVA_XMX_MB = env_int("LC3_RUN_JAVA_XMX_MB", 64)
COMPILE_MEM_MB = env_int("LC3_COMPILE_MEM_MB", 384)
COMPILE_TIMEOUT = env_int("LC3_COMPILE_TIMEOUT", 60)
RUN_MEM_MB = env_int("LC3_RUN_MEM_MB", 256)
RUN_TIMEOUT = env_int("LC3_RUN_TIMEOUT", 600)

# Fallback resource limits, used only when systemd-run is absent (containers).
# RLIMIT_AS is applied to Python jobs only: a JVM reserves a large virtual
# address space up front and dies under an address-space cap, so Java is held
# by -Xmx and the container's own memory limit instead.
ULIMIT_AS = env_flag("LC3_ULIMIT_AS", True)
try:
    ULIMIT_AS_MULT = float(env_str("LC3_ULIMIT_AS_MULT", "2.0"))
except ValueError:
    ULIMIT_AS_MULT = 2.0
ULIMIT_FSIZE_KB = env_int("LC3_ULIMIT_FSIZE_KB", 131072)

GRADE_MAX = max(1, env_int("LC3_GRADE_CONCURRENCY", 2))
_grade_lock = threading.Semaphore(GRADE_MAX)

# The teacher's worker shell is off unless a token is configured, and the token
# is the only thing standing between the runner's port and a root shell on this
# node. See shell_start().
SHELL_TOKEN = env_str("LC3_SHELL_TOKEN", "")
SHELL_CMD = env_str("LC3_SHELL", "/bin/bash")
SHELL_MAX = max(1, env_int("LC3_MAX_SHELLS", 2))
# A live terminal long-polls for output at least every 25 seconds, so anything
# quiet for minutes is a browser tab that went away without closing its shell.
# Closing the tab is the normal way out, and a slot held by a shell nobody is
# reading is a slot the next teacher cannot have.
SHELL_IDLE_SEC = max(60, env_int("LC3_SHELL_IDLE_SEC", 300))


def have_systemd_run():
    """systemd-run gives each job its own cgroup (memory, tasks, CPU). It
    exists on the Pi 4 gateway and on Arch workers, never inside a container."""
    if not env_flag("LC3_USE_SYSTEMD_RUN", True):
        return False
    if shutil.which("systemd-run") is None:
        return False
    return os.path.isdir("/run/systemd/system")


USE_SYSTEMD_RUN = have_systemd_run()


def usr_layout():
    """Reproduce the host's /bin, /sbin, /lib, /lib64 inside the sandbox.

    Merged-usr distributions differ in where these point -- Arch sends /lib64
    to usr/lib, Debian x86_64 to usr/lib64, Debian arm64 has no /lib64 at all
    -- and getting it wrong hides the dynamic loader, so every exec in the
    sandbox fails with a bare "No such file or directory"."""
    args = []
    for d in ("/bin", "/sbin", "/lib", "/lib64"):
        if os.path.islink(d):
            args += ["--symlink", os.readlink(d), d]
        elif os.path.isdir(d):
            args += ["--ro-bind", d, d]
    return args


USR_LAYOUT = usr_layout()


def write_files(base, files):
    for rel, b64 in files.items():
        rel = rel.lstrip("/")
        p = os.path.normpath(os.path.join(base, rel))
        if not p.startswith(base):
            continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(base64.b64decode(b64))


def sandbox_cmd(job_dir, mem_mb, timeout_sec, inner, vmem_limit=False):
    """Resource limits + timeout + bwrap (fs/net/pid isolation). The job dir is
    the only writable host path.

    Limits come from a systemd-run transient scope (a real cgroup) where systemd
    is running. In a container there is no systemd, so the job gets shell
    rlimits instead and the container's own cgroup (mem_limit / pids_limit in
    docker-compose.yml) is the outer cap. The isolation that matters for
    grading -- no network, no host filesystem, no host pids -- is bwrap's and is
    identical either way."""
    limits = []
    if USE_SYSTEMD_RUN:
        limits = [
            "systemd-run", "--scope", "--collect", "-q",
            "-p", f"MemoryMax={mem_mb}M",
            "-p", "MemorySwapMax=0",
            "-p", f"TasksMax={TASKS_MAX}",
            "-p", f"CPUQuota={CPU_QUOTA}",
        ]
    else:
        prefix = [f"ulimit -f {ULIMIT_FSIZE_KB} 2>/dev/null || true"]
        if vmem_limit and ULIMIT_AS:
            kb = int(mem_mb * 1024 * ULIMIT_AS_MULT)
            prefix.append(f"ulimit -v {kb} 2>/dev/null || true")
        prefix.append(f"ulimit -u {TASKS_MAX} 2>/dev/null || true")
        inner = "; ".join(prefix) + "; " + inner

    binds = []
    for path in [JAVA_LIBS] + SANDBOX_ROBINDS:
        binds += ["--ro-bind-try", path, path]

    return limits + [
        "timeout", "-k", "3", str(timeout_sec),
        "bwrap",
        "--die-with-parent",
        "--unshare-all",
        "--ro-bind", "/usr", "/usr",
    ] + USR_LAYOUT + [
        "--ro-bind", "/etc", "/etc",
    ] + binds + [
        "--tmpfs", "/tmp",
        "--proc", "/proc",
        "--dev", "/dev",
        "--bind", job_dir, "/work",
        "--chdir", "/work",
        "--setenv", "HOME", "/work",
        "--setenv", "TMPDIR", "/tmp",
        "--setenv", "PATH", SANDBOX_PATH,
        "--unsetenv", "LD_PRELOAD",
        "bash", "-c", inner,
    ]


def run_sandboxed(job_dir, mem_mb, timeout_sec, inner, vmem_limit=False):
    cmd = sandbox_cmd(job_dir, mem_mb, timeout_sec, inner, vmem_limit=vmem_limit)
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          timeout=timeout_sec + 30)
    return proc.returncode


def grade_python(job_dir, timeout_sec, mem_mb):
    # The harness runs as the sandbox entry point: it reads the private tests
    # into memory and deletes their source before importing student code, so
    # student code cannot open the test files to read expected answers.
    shutil.copyfile(PYHARNESS, os.path.join(job_dir, ".lc3_harness.py"))
    inner = PYTHON_BIN + " /work/.lc3_harness.py"
    rc = run_sandboxed(job_dir, mem_mb, timeout_sec, inner, vmem_limit=True)
    report = os.path.join(job_dir, ".lc3-report.json")
    if rc in (124, 137) and not os.path.isfile(report):
        return {"status": "timeout", "tests": []}
    if not os.path.isfile(report):
        return {"status": "error", "tests": []}
    try:
        with open(report) as f:
            result = json.load(f)
    except (OSError, ValueError):
        return {"status": "error", "tests": []}
    tests = [{"name": t.get("name", "?"), "passed": bool(t.get("passed"))}
             for t in result.get("tests", [])]
    if rc in (124, 137):
        return {"status": "timeout", "tests": tests}
    return {"status": result.get("status", "error"), "tests": tests}


def grade_java(job_dir, timeout_sec, mem_mb):
    jars = f"{JAVA_LIBS}/junit.jar:{JAVA_LIBS}/hamcrest.jar:{JAVA_LIBS}/lc3runner"
    # Compile everything, then delete all .java source (student and tests)
    # before running: student code cannot read the test source at runtime.
    # Only .class files remain, so the private tests are not lying around.
    inner = (
        "mkdir -p /work/.classes && "
        "javac --release 8 -Xlint:-options -encoding UTF-8 -cp '" + jars + "' -d /work/.classes "
        "$(find /work -maxdepth 3 -name '*.java') "
        ">/work/.lc3-compile.txt 2>&1 "
        "&& echo COMPILED > /work/.lc3-compiled "
        "&& find /work -maxdepth 3 -name '*.java' -delete "
        "&& java -Xmx" + str(max(MEM_MIN_MB, min(MEM_MAX_MB, GRADE_JAVA_XMX_MB))) + "m "
        "-cp '/work/.classes:" + jars + "' LC3Runner "
        "$(cd /work/.classes && ls *Test*.class 2>/dev/null | sed 's/\\.class$//' | grep -v '\\$') "
        ">/work/.lc3-results.txt 2>/work/.lc3-stderr.txt"
    )
    rc = run_sandboxed(job_dir, mem_mb, timeout_sec, inner)
    if not os.path.isfile(os.path.join(job_dir, ".lc3-compiled")):
        return {"status": "compile_error", "tests": []}
    results = os.path.join(job_dir, ".lc3-results.txt")
    if rc in (124, 137) and not os.path.isfile(results):
        return {"status": "timeout", "tests": []}
    tests = []
    try:
        with open(results, "r", errors="replace") as f:
            for line in f:
                parts = line.strip().split(" ", 2)
                if len(parts) >= 3 and parts[0] == "LC3TEST":
                    tests.append({"name": parts[2],
                                  "passed": parts[1] == "PASS"})
    except OSError:
        pass
    if rc in (124, 137):
        return {"status": "timeout", "tests": tests}
    if not tests:
        return {"status": "error", "tests": []}
    return {"status": "ok", "tests": tests}


WRAPPER_SRC = """\
public class LC3Main {
    public static void main(String[] args) throws Exception {
        java.io.File f = new java.io.File("/str/lc3_stdin.txt");
        if (f.exists() && f.length() > 0) {
            System.setIn(new java.io.FileInputStream(f));
        }
        %s.main(args);
    }
}
"""


def find_main_class(files_dir, entry):
    """Best-effort: the class with a main method, preferring the entry file.
    Returns (class_name, has_package)."""
    import re
    candidates = []
    for dirpath, _, filenames in os.walk(files_dir):
        for fn in filenames:
            if not fn.endswith(".java"):
                continue
            p = os.path.join(dirpath, fn)
            try:
                with open(p, "r", errors="replace") as f:
                    src = f.read()
            except OSError:
                continue
            if re.search(r"static\s+void\s+main\s*\(", src):
                pkg = re.search(r"^\s*package\s+([\w.]+)\s*;", src, re.M)
                cls = fn[:-5]
                name = (pkg.group(1) + "." + cls) if pkg else cls
                candidates.append((fn == os.path.basename(entry), name, bool(pkg)))
    if not candidates:
        return None, False
    candidates.sort(key=lambda c: (not c[0],))
    return candidates[0][1], candidates[0][2]


def compile_java(payload):
    entry = payload.get("entry", "")
    os.makedirs(JOBS_DIR, exist_ok=True)
    job_dir = os.path.join(JOBS_DIR, uuid.uuid4().hex[:12])
    os.makedirs(job_dir)
    try:
        write_files(job_dir, payload.get("files", {}))
        main_class, has_pkg = find_main_class(job_dir, entry)
        if not main_class:
            return {"status": "compile_error",
                    "output": "No class with 'public static void main' found."}
        wrapper = None
        if not has_pkg:
            wrapper = "LC3Main"
            with open(os.path.join(job_dir, "LC3Main.java"), "w") as f:
                f.write(WRAPPER_SRC % main_class)
        # Target Java 8 bytecode: AP CS A is a Java 8 course, and it runs in the
        # browser on CheerpJ's default Java 8 mode.
        inner = (
            "mkdir -p /work/.classes && "
            "javac --release 8 -Xlint:-options -encoding UTF-8 -d /work/.classes "
            "$(find /work -maxdepth 3 -name '*.java') "
            ">/work/.lc3-compile.txt 2>&1 && echo OK > /work/.lc3-compiled"
        )
        run_sandboxed(job_dir, COMPILE_MEM_MB, COMPILE_TIMEOUT, inner)
        if not os.path.isfile(os.path.join(job_dir, ".lc3-compiled")):
            try:
                with open(os.path.join(job_dir, ".lc3-compile.txt"), errors="replace") as f:
                    out = f.read(20000)
            except OSError:
                out = "compilation failed"
            return {"status": "compile_error",
                    "output": out.replace(job_dir, "").replace("/work/", "")}
        classes = {}
        cls_dir = os.path.join(job_dir, ".classes")
        for dirpath, _, filenames in os.walk(cls_dir):
            for fn in filenames:
                if fn.endswith(".class"):
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, cls_dir)
                    with open(full, "rb") as f:
                        classes[rel] = base64.b64encode(f.read()).decode()
        return {"status": "ok", "classes": classes, "main_class": main_class,
                "wrapper_class": wrapper}
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def grade(payload):
    language = payload.get("language", "python")
    timeout_sec = max(3, min(MAX_TIMEOUT, int(payload.get("timeout_sec", 15))))
    mem_mb = max(MEM_MIN_MB, min(MEM_MAX_MB, int(payload.get("mem_mb", 256))))
    os.makedirs(JOBS_DIR, exist_ok=True)
    job_dir = os.path.join(JOBS_DIR, uuid.uuid4().hex[:12])
    os.makedirs(job_dir)
    try:
        write_files(job_dir, payload.get("files", {}))
        write_files(job_dir, payload.get("tests", {}))
        if language == "java":
            return grade_java(job_dir, timeout_sec, mem_mb)
        return grade_python(job_dir, timeout_sec, mem_mb)
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


# ----------------------- interactive execution -----------------------------
# A run is a real process in the sandbox with its stdin and stdout wired to the
# gateway, which relays them to the student's terminal. Scanner/System.in block
# and wait for input, exactly like a local program. Runs are capped per node
# (scaled to its RAM) so a Pi 3 is not overloaded.

def _default_max_runs():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    mb = int(line.split()[1]) // 1024
                    return max(4, min(20, (mb - 350) // 130))
    except Exception:
        pass
    return 8


RUN_MAX = max(1, env_int("LC3_MAX_RUNS", _default_max_runs()))
_run_sem = threading.Semaphore(RUN_MAX)
_sessions = {}
_sessions_lock = threading.Lock()

# Live occupancy, reported by /health so the teacher can see which node is busy.
# A semaphore does not expose its own count, so track it alongside.
_busy = {"runs": 0, "grades": 0, "shells": 0}
_busy_lock = threading.Lock()


def busy_add(kind, d):
    with _busy_lock:
        _busy[kind] = max(0, _busy[kind] + d)


class RunSession:
    def __init__(self, job_dir, proc):
        self.job_dir = job_dir
        self.proc = proc
        self.buf = bytearray()
        self.done = False
        self.exit = 0
        self.cond = threading.Condition()

    def append(self, b):
        with self.cond:
            self.buf.extend(b)
            self.cond.notify_all()

    def finish(self, code):
        with self.cond:
            self.done = True
            self.exit = code
            self.cond.notify_all()

    def read(self, since, max_wait):
        with self.cond:
            if since >= len(self.buf) and not self.done:
                self.cond.wait(timeout=max_wait)
            data = bytes(self.buf[since:])
            return data, len(self.buf), self.done, self.exit


def _reader(sess, sid):
    try:
        while True:
            chunk = sess.proc.stdout.read(4096)
            if not chunk:
                break
            sess.append(chunk)
    except Exception:
        pass
    try:
        sess.proc.wait()
    except Exception:
        pass
    sess.finish(sess.proc.returncode if sess.proc.returncode is not None else 0)
    _run_sem.release()
    busy_add("runs", -1)
    shutil.rmtree(sess.job_dir, ignore_errors=True)

    def _cleanup():
        time.sleep(60)
        with _sessions_lock:
            _sessions.pop(sid, None)
    threading.Thread(target=_cleanup, daemon=True).start()


def exec_compile_java(job_dir):
    inner = (
        "mkdir -p /work/.classes && "
        "javac --release 8 -Xlint:-options -d /work/.classes "
        "$(find /work -maxdepth 3 -name '*.java') >/work/.compile.txt 2>&1 && "
        "echo OK > /work/.compiled"
    )
    run_sandboxed(job_dir, COMPILE_MEM_MB, COMPILE_TIMEOUT, inner)
    if os.path.isfile(os.path.join(job_dir, ".compiled")):
        return True, ""
    try:
        with open(os.path.join(job_dir, ".compile.txt"), errors="replace") as f:
            out = f.read(20000)
    except OSError:
        out = "compilation failed"
    return False, out.replace("/work/", "")


def exec_start(payload):
    lang = payload.get("language", "java")
    entry = payload.get("entry", "")
    if not _run_sem.acquire(timeout=15):
        return {"status": "busy"}
    busy_add("runs", 1)
    os.makedirs(JOBS_DIR, exist_ok=True)
    job_dir = os.path.join(JOBS_DIR, "run-" + uuid.uuid4().hex[:12])
    os.makedirs(job_dir)
    try:
        write_files(job_dir, payload.get("files", {}))
        if lang == "java":
            ok, out = exec_compile_java(job_dir)
            if not ok:
                _run_sem.release()
                busy_add("runs", -1)
                shutil.rmtree(job_dir, ignore_errors=True)
                return {"status": "compile_error", "output": out}
            main_class = entry[:-5] if entry.endswith(".java") else entry
            inner = ("java -Xmx" + str(RUN_JAVA_XMX_MB) + "m -XX:+UseSerialGC "
                     "-XX:TieredStopAtLevel=1 -cp /work/.classes " + main_class)
        else:
            main = entry or "main.py"
            inner = PYTHON_BIN + " /work/" + main
        cmd = sandbox_cmd(job_dir, RUN_MEM_MB, RUN_TIMEOUT, inner,
                          vmem_limit=(lang != "java"))
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, bufsize=0)
        sess = RunSession(job_dir, proc)
        sid = uuid.uuid4().hex[:16]
        with _sessions_lock:
            _sessions[sid] = sess
        threading.Thread(target=_reader, args=(sess, sid), daemon=True).start()
        return {"status": "running", "session": sid}
    except Exception as e:
        _run_sem.release()
        busy_add("runs", -1)
        shutil.rmtree(job_dir, ignore_errors=True)
        return {"status": "error", "output": type(e).__name__}


def exec_output(payload):
    sid = payload.get("session", "")
    since = int(payload.get("since", 0) or 0)
    with _sessions_lock:
        sess = _sessions.get(sid)
    if sess is None:
        return {"data": "", "next": since, "done": True, "exit": 0}
    data, nxt, done, code = sess.read(since, 25)
    return {"data": data.decode("utf-8", "replace"), "next": nxt, "done": done, "exit": code}


def exec_input(payload):
    sid = payload.get("session", "")
    with _sessions_lock:
        sess = _sessions.get(sid)
    if sess is None:
        return {"ok": False}
    line = payload.get("data", "")
    line = line.rstrip("\r\n") + "\n"
    try:
        sess.proc.stdin.write(line.encode("utf-8", "replace"))
        sess.proc.stdin.flush()
    except Exception:
        pass
    return {"ok": True}


def exec_kill(payload):
    sid = payload.get("session", "")
    with _sessions_lock:
        sess = _sessions.get(sid)
    if sess is not None:
        try:
            sess.proc.kill()
        except Exception:
            pass
    return {"ok": True}


# ------------------------------ worker shell -------------------------------
# A real login shell on this node, for the teacher to inspect a worker that is
# misbehaving. It is deliberately NOT sandboxed -- a shell that cannot see the
# host filesystem or the service logs would not answer the question the teacher
# opened it to answer -- so it runs with the runner's own privileges, which on a
# provisioned worker means root.
#
# Two things keep that from being a hole. The endpoints do not exist unless
# LC3_SHELL_TOKEN is set on this node, and every request must carry that token.
# The gateway holds the token and only ever forwards a request for a signed-in
# teacher, so the runner port alone grants nothing.

_shells = {}
_shells_lock = threading.Lock()


class ShellSession:
    def __init__(self, proc, fd):
        self.proc = proc
        self.fd = fd
        self.buf = bytearray()
        # Offsets the terminal sends back are positions in the whole stream, not
        # into buf, because buf is a sliding window. base is how much has been
        # dropped off the front, and is what keeps the two in step.
        self.base = 0
        self.done = False
        self.exit = 0
        self.touched = time.time()
        self.cond = threading.Condition()

    def append(self, b):
        with self.cond:
            self.buf.extend(b)
            # A long-lived shell would otherwise grow without bound; keep the
            # tail, which is what a reconnecting terminal can still use.
            if len(self.buf) > (1 << 20):
                drop = len(self.buf) - (1 << 19)
                del self.buf[:drop]
                self.base += drop
            self.cond.notify_all()

    def finish(self, code):
        with self.cond:
            self.done = True
            self.exit = code
            self.cond.notify_all()

    def read(self, since, max_wait):
        with self.cond:
            end = self.base + len(self.buf)
            if since >= end and not self.done:
                self.cond.wait(timeout=max_wait)
                end = self.base + len(self.buf)
            # A terminal that fell behind a trim resumes at the oldest byte
            # still held rather than replaying from a position that is gone.
            start = min(max(since, self.base), end)
            return bytes(self.buf[start - self.base:]), end, self.done, self.exit


def shell_enabled():
    return bool(SHELL_TOKEN)


def shell_authed(payload):
    tok = payload.get("token", "")
    return isinstance(tok, str) and hmac.compare_digest(tok, SHELL_TOKEN)


def _shell_reader(sess, sid):
    try:
        while True:
            try:
                chunk = os.read(sess.fd, 4096)
            except OSError:
                break
            if not chunk:
                break
            sess.append(chunk)
    finally:
        try:
            sess.proc.wait(timeout=5)
        except Exception:
            pass
        sess.finish(sess.proc.returncode if sess.proc.returncode is not None else 0)
        try:
            os.close(sess.fd)
        except OSError:
            pass
        busy_add("shells", -1)

        def _cleanup():
            time.sleep(60)
            with _shells_lock:
                _shells.pop(sid, None)
        threading.Thread(target=_cleanup, daemon=True).start()


def _shell_reaper():
    """Close shells nobody is reading any more: a teacher who closes the browser
    tab never sends a kill, and an orphaned root shell should not outlive them."""
    while True:
        time.sleep(30)
        now = time.time()
        with _shells_lock:
            stale = [s for s in _shells.values()
                     if not s.done and now - s.touched > SHELL_IDLE_SEC]
        for s in stale:
            try:
                os.killpg(os.getpgid(s.proc.pid), signal.SIGHUP)
            except Exception:
                pass


def set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ,
                    struct.pack("HHHH", max(1, rows), max(1, cols), 0, 0))
    except OSError:
        pass


def shell_start(payload):
    with _busy_lock:
        if _busy["shells"] >= SHELL_MAX:
            return {"status": "busy"}
        _busy["shells"] += 1
    try:
        master, slave = pty.openpty()
        set_winsize(master, int(payload.get("rows", 24) or 24),
                    int(payload.get("cols", 80) or 80))
        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        env["LC3_WORKER_SHELL"] = "1"
        proc = subprocess.Popen(
            [SHELL_CMD, "-i"], stdin=slave, stdout=slave, stderr=slave,
            start_new_session=True, close_fds=True, env=env, cwd="/")
        os.close(slave)
        sess = ShellSession(proc, master)
        sid = uuid.uuid4().hex[:16]
        with _shells_lock:
            _shells[sid] = sess
        threading.Thread(target=_shell_reader, args=(sess, sid), daemon=True).start()
        return {"status": "running", "session": sid}
    except Exception as e:
        busy_add("shells", -1)
        return {"status": "error", "output": type(e).__name__}


def _shell_get(payload):
    with _shells_lock:
        return _shells.get(payload.get("session", ""))


def shell_output(payload):
    since = int(payload.get("since", 0) or 0)
    sess = _shell_get(payload)
    if sess is None:
        return {"data": "", "next": since, "done": True, "exit": 0}
    sess.touched = time.time()
    data, nxt, done, code = sess.read(since, 25)
    return {"data": base64.b64encode(data).decode(), "next": nxt,
            "done": done, "exit": code}


def shell_input(payload):
    sess = _shell_get(payload)
    if sess is None:
        return {"ok": False}
    sess.touched = time.time()
    try:
        os.write(sess.fd, base64.b64decode(payload.get("data", "")))
    except Exception:
        return {"ok": False}
    return {"ok": True}


def shell_resize(payload):
    sess = _shell_get(payload)
    if sess is None:
        return {"ok": False}
    set_winsize(sess.fd, int(payload.get("rows", 24) or 24),
                int(payload.get("cols", 80) or 80))
    return {"ok": True}


def shell_kill(payload):
    sess = _shell_get(payload)
    if sess is not None:
        try:
            os.killpg(os.getpgid(sess.proc.pid), signal.SIGKILL)
        except Exception:
            pass
    return {"ok": True}


# ------------------------------- load report -------------------------------

def _loadavg():
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except OSError:
        return [0.0, 0.0, 0.0]


def _mem():
    total = avail = 0
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    total = int(line.split()[1]) // 1024
                elif line.startswith("MemAvailable"):
                    avail = int(line.split()[1]) // 1024
    except OSError:
        pass
    return total, avail


def health():
    with _busy_lock:
        runs, grades, shells = _busy["runs"], _busy["grades"], _busy["shells"]
    total, avail = _mem()
    load = _loadavg()
    return {
        "ok": True,
        "runs": runs, "max_runs": RUN_MAX,
        "grades": grades, "max_grades": GRADE_MAX,
        "shells": shells,
        "loadavg": load,
        "cpus": os.cpu_count() or 1,
        "mem_total_mb": total, "mem_avail_mb": avail,
        "shell_available": shell_enabled(),
        "java": bool(shutil.which("javac")),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, health())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        exec_paths = {
            "/exec/start": exec_start, "/exec/output": exec_output,
            "/exec/input": exec_input, "/exec/kill": exec_kill,
        }
        shell_paths = {
            "/shell/start": shell_start, "/shell/output": shell_output,
            "/shell/input": shell_input, "/shell/resize": shell_resize,
            "/shell/kill": shell_kill,
        }
        known = self.path in ("/grade", "/compile") or self.path in exec_paths
        # With no token configured this node has no shell, and says so the same
        # way it would for any path it does not serve.
        if self.path in shell_paths and shell_enabled():
            known = True
        if not known:
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 32 * 1024 * 1024:
                self._send(413, {"error": "too large"})
                return
            payload = json.loads(self.rfile.read(length).decode())
        except Exception:
            self._send(400, {"error": "bad json"})
            return

        if self.path in shell_paths:
            if not shell_authed(payload):
                self._send(403, {"error": "forbidden"})
                return
            try:
                result = shell_paths[self.path](payload)
            except Exception as e:
                result = {"status": "error", "note": type(e).__name__}
            self._send(200, result)
            return

        # Interactive endpoints have their own concurrency control and must not
        # take the grading lock (exec/output long-polls for up to 25s).
        if self.path in exec_paths:
            try:
                result = exec_paths[self.path](payload)
            except Exception as e:
                result = {"status": "error", "note": type(e).__name__}
            self._send(200, result)
            return

        with _grade_lock:
            busy_add("grades", 1)
            try:
                if self.path == "/compile":
                    result = compile_java(payload)
                else:
                    result = grade(payload)
            except Exception as e:
                result = {"status": "error", "tests": [], "note": type(e).__name__}
            finally:
                busy_add("grades", -1)
        self._send(200, result)


def worker_id():
    """A stable id the gateway tracks this worker by. On balenaOS the device
    UUID is already stable and unique per device, so a fleet needs no per-device
    id variable: set LC3_WORKER_ID only to override it."""
    wid = env_str("LC3_WORKER_ID", "")
    if wid:
        return wid
    uuid_ = env_str("BALENA_DEVICE_UUID", "")
    if uuid_:
        return "w-" + uuid_[:12]
    return ""


def _cdn_ready(cdn_port):
    """True when this node's own asset mirror can serve /heavy/. The gateway
    load-balances student asset downloads across every worker it has heard from,
    and a half-mirrored worker answers 404 (which nginx does not fail over), so
    a worker stays silent until its mirror is complete."""
    import urllib.request
    try:
        with urllib.request.urlopen(
                "http://127.0.0.1:%d/health" % cdn_port, timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _heartbeat_loop():
    """Report to the gateway under a stable worker id. The gateway learns this
    worker's current IP from the connection, so a DHCP address change is handled
    automatically. Inactive on the gateway-local runner."""
    import urllib.request
    gw = env_str("LC3_GATEWAY", "")
    wid = worker_id()
    token = env_str("LC3_WORKER_TOKEN", "")
    if not (gw and wid and token):
        print("[lc3] heartbeat disabled (need LC3_GATEWAY, LC3_WORKER_TOKEN)",
              flush=True)
        return
    cdn = env_int("LC3_RUNNER_CDN_PORT", 80)
    interval = max(5, env_int("LC3_HEARTBEAT_SEC", 30))
    gate = env_flag("LC3_CDN_GATE", True) and cdn > 0
    url = "http://%s/api/worker/heartbeat" % gw
    payload = json.dumps(
        {"id": wid, "token": token, "runner_port": PORT, "cdn_port": cdn}).encode()
    print("[lc3] heartbeat %s as %s every %ds (cdn gate: %s)"
          % (url, wid, interval, "on" if gate else "off"), flush=True)
    waiting = False
    while True:
        if gate and not _cdn_ready(cdn):
            if not waiting:
                print("[lc3] holding heartbeat until the asset mirror is ready",
                      flush=True)
                waiting = True
            time.sleep(interval)
            continue
        waiting = False
        try:
            req = urllib.request.Request(
                url, data=payload, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=5).read()
        except Exception as e:
            print("[lc3] heartbeat failed: %s" % type(e).__name__, flush=True)
        time.sleep(interval)


def _preflight():
    """Fail loudly at start, not on the first submission: bwrap is the whole
    sandbox, and in a container it needs the privileges to unshare namespaces."""
    os.makedirs(JOBS_DIR, exist_ok=True)
    if shutil.which("bwrap") is None:
        print("[lc3] FATAL: bwrap not installed; grading cannot be sandboxed",
              flush=True)
        raise SystemExit(1)
    probe_dir = os.path.join(JOBS_DIR, "preflight")
    os.makedirs(probe_dir, exist_ok=True)
    try:
        probe = subprocess.run(
            sandbox_cmd(probe_dir, 64, 10, "true"),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=30)
    finally:
        shutil.rmtree(probe_dir, ignore_errors=True)
    if probe.returncode != 0:
        print("[lc3] FATAL: bwrap cannot unshare namespaces: %s"
              % probe.stderr.decode("utf-8", "replace").strip(), flush=True)
        print("[lc3] in a container the service needs privileged: true", flush=True)
        raise SystemExit(1)
    print("[lc3] runner on %s:%d | job limits: %s | max runs: %d | java: %s | shell: %s"
          % (BIND, PORT, "systemd cgroups" if USE_SYSTEMD_RUN else "container rlimits",
             RUN_MAX, shutil.which("javac") or "missing",
             "on" if shell_enabled() else "off"), flush=True)


if __name__ == "__main__":
    _preflight()
    os.makedirs(JOBS_DIR, exist_ok=True)
    threading.Thread(target=_heartbeat_loop, daemon=True).start()
    if shell_enabled():
        threading.Thread(target=_shell_reaper, daemon=True).start()
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
