"""In-sandbox grading harness.

Runs inside the bwrap sandbox as the sole entry point. It reads the private
test files into memory, deletes their source from disk, and only then imports
and exercises the student's code. A student's code therefore cannot open the
test files to read expected answers: by the time it runs, the files are gone
and only what this process holds in memory remains.

Two kinds of test live in tests/:

  test_*.py    pytest-style: functions named test_*, plain assert. Either
  *_test.py    name pattern (pytest's own rule) marks a file as unit tests.
               The student's module is imported by name. A student file with code
               at the top level (prints, input() calls, no main guard) still
               imports: each top-level statement runs on its own with stdin
               empty and output discarded, and a statement that fails is
               skipped, so the definitions around it survive.

  <case>.out   an input/output case: the program is run as a whole with
  <case>.in    <case>.in as its stdin (empty when there is no .in), and what
               it prints must match <case>.out line for line, ignoring
               trailing spaces and trailing blank lines. This is the test that
               needs no main guard and no functions: it checks the program.

Invocation:
  .lc3_harness.py                 Python: both kinds, LC3_ENTRY names the
                                  program file for the cases
  .lc3_harness.py --io CMD...     any language: the cases only, running CMD
                                  with each case's stdin (Java uses this
                                  after compiling)

Writes JSON to /work/.lc3-report.json:
  {"status": "ok"|"compile_error"|"error", "tests": [{"name","passed"}],
   "reason": "..."}
The reason says, in one line, why a status is not ok: tests/ held no test
files, a test file would not import, the student's file has a syntax error.
The gateway shows it to a teacher rehearsing an assignment, never to a
student.
"""

import ast
import importlib.abc
import importlib.util
import io
import json
import os
import subprocess
import sys
import traceback

WORK = "/work"
REPORT = "/work/.lc3-report.json"
CASE_TIMEOUT = max(3, int(os.environ.get("LC3_TIMEOUT", "15") or 15))


# ----------------------------- reading tests ------------------------------

def slurp_and_remove(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            data = f.read()
    except OSError:
        return None
    try:
        os.remove(path)  # gone before any student code runs
    except OSError:
        pass
    return data


def collect_io_cases():
    """Every <case>.out in /work, with its .in if there is one. Both files are
    removed from disk here."""
    cases = []
    for name in sorted(os.listdir(WORK)):
        if not name.endswith(".out"):
            continue
        stem = name[:-4]
        expected = slurp_and_remove(os.path.join(WORK, name))
        if expected is None:
            continue
        given = slurp_and_remove(os.path.join(WORK, stem + ".in")) or ""
        cases.append((stem, given, expected))
    return cases


def is_unit_test(name):
    return name.endswith(".py") and (name.startswith("test_") or name.endswith("_test.py"))


def collect_unit_tests():
    sources = {}
    for name in sorted(os.listdir(WORK)):
        if is_unit_test(name):
            src = slurp_and_remove(os.path.join(WORK, name))
            if src is not None:
                sources[name] = src
    return sources


# ------------------------- importing student code -------------------------

class _LenientLoader(importlib.abc.Loader):
    """Imports a student file one top-level statement at a time.

    A file written as a script (input(), prints, a loop at the top level) has
    to be importable for the function tests to reach its definitions. So each
    statement runs on its own: input() sees an empty stdin and raises, the
    statement is abandoned, and the next one runs. Definitions, imports and
    constants come through; a script's side effects do not."""

    def __init__(self, path):
        self.path = path

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        with open(self.path, "r", encoding="utf-8", errors="replace") as f:
            src = f.read()
        tree = ast.parse(src, self.path)  # a SyntaxError is a compile error
        module.__file__ = self.path
        ns = module.__dict__
        for node in tree.body:
            code = compile(ast.Module(body=[node], type_ignores=[]), self.path, "exec")
            try:
                exec(code, ns)
            except (Exception, SystemExit):
                continue


class _WorkFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if path is not None or "." in name:
            return None
        p = os.path.join(WORK, name + ".py")
        if not os.path.isfile(p):
            return None
        return importlib.util.spec_from_loader(name, _LenientLoader(p), origin=p)


def describe(exc):
    """One line naming an exception, with the file and line for a SyntaxError."""
    if isinstance(exc, SyntaxError) and exc.filename:
        return "%s in %s line %s: %s" % (type(exc).__name__,
                                          os.path.basename(exc.filename),
                                          exc.lineno, exc.msg)
    text = str(exc).strip().splitlines()
    return type(exc).__name__ + (": " + text[0] if text else "")


class _Quiet:
    """stdout/stderr to nowhere, stdin at end of file, for the duration."""

    def __enter__(self):
        self.saved = sys.stdin, sys.stdout, sys.stderr
        sys.stdin = io.StringIO("")
        sys.stdout = sys.stderr = io.StringIO()
        return self

    def __exit__(self, *exc):
        sys.stdin, sys.stdout, sys.stderr = self.saved
        return False


# ------------------------------ unit tests --------------------------------

def run_unit_tests(sources):
    """Returns (status, results, reason)."""
    compiled = {}
    for name, src in sources.items():
        try:
            compiled[name] = compile(src, name, "exec")
        except SyntaxError as e:
            # a broken private test is an author error, not a student failure
            return "error", [], "the test file has a " + describe(e)

    sys.path.insert(0, WORK)
    sys.meta_path.insert(0, _WorkFinder())

    results = []
    status = "ok"
    reason = ""
    for name, code in compiled.items():
        module_ns = {"__name__": "lc3_" + name[:-3]}
        try:
            with _Quiet():
                exec(code, module_ns)
        except Exception as e:
            # Importing the student module (or the test file itself) blew up.
            # The lenient loader swallows failing statements, so this is a
            # syntax error in the student's file, or a test that imports a
            # module nobody wrote.
            status = "compile_error"
            reason = reason or (name + " could not be imported: " + describe(e))
            continue
        for attr in sorted(module_ns):
            if not attr.startswith("test_"):
                continue
            fn = module_ns[attr]
            if not callable(fn):
                continue
            passed = True
            try:
                with _Quiet():
                    fn()
            except Exception:
                passed = False
            results.append({"name": name[:-3] + "." + attr, "passed": passed})
    if not results and status == "ok":
        status = "error"
        reason = ", ".join(sorted(compiled)) + " defines no test_* functions"
    return status, results, reason


# ---------------------------- input/output cases --------------------------

def normalize(text):
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return lines


def run_io_cases(cmd, cases):
    results = []
    for stem, given, expected in cases:
        passed = False
        try:
            proc = subprocess.run(cmd, input=given.encode("utf-8"),
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  cwd=WORK, timeout=CASE_TIMEOUT)
            got = proc.stdout.decode("utf-8", "replace")
            passed = proc.returncode == 0 and normalize(got) == normalize(expected)
        except (subprocess.TimeoutExpired, OSError):
            passed = False
        results.append({"name": "io." + stem, "passed": passed})
    return results


def python_entry():
    """The program the cases run: LC3_ENTRY if it names a file here, else
    main.py, else the one .py file, else the first one."""
    wanted = os.environ.get("LC3_ENTRY", "")
    if wanted and os.path.isfile(os.path.join(WORK, wanted)):
        return wanted
    if os.path.isfile(os.path.join(WORK, "main.py")):
        return "main.py"
    files = sorted(n for n in os.listdir(WORK)
                   if n.endswith(".py") and not n.startswith(".") and not is_unit_test(n))
    return files[0] if files else "main.py"


# ---------------------------------- main ----------------------------------

def main(argv):
    if argv[1:2] == ["--io"]:
        cases = collect_io_cases()
        if not cases:
            write({"status": "ok", "tests": []})
            return
        write({"status": "ok", "tests": run_io_cases(argv[2:], cases)})
        return

    cases = collect_io_cases()
    sources = collect_unit_tests()
    if not sources and not cases:
        write({"status": "error", "tests": [],
               "reason": "tests/ has no test files: unit tests are test_*.py "
                         "or *_test.py, input/output cases are <case>.out"})
        return

    # The cases run the program whole, before the tests import it: an import
    # that fails must not stop the cases from being tried.
    results = run_io_cases([sys.executable, os.path.join(WORK, python_entry())], cases)
    status, reason = "ok", ""
    if sources:
        status, unit, reason = run_unit_tests(sources)
        results = unit + results
    write({"status": status, "tests": results, "reason": reason})


def write(obj):
    with open(REPORT, "w") as f:
        json.dump(obj, f)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except Exception:
        try:
            with open(REPORT, "w") as f:
                json.dump({"status": "error", "tests": [],
                           "reason": "the grading harness failed: " +
                                     traceback.format_exc().strip().splitlines()[-1]}, f)
        except OSError:
            pass
