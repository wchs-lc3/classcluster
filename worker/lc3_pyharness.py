"""In-sandbox Python grading harness.

Runs inside the bwrap sandbox as the sole entry point. It reads the private
test files into memory, deletes their source from disk, and only then imports
and exercises the student's code. A student's code therefore cannot open the
test files to read expected answers: by the time it runs, the files are gone
and only compiled code objects held by this process remain.

Test format: pytest-style. Files named test_*.py, functions named test_*,
plain `assert` for checks. Fixtures and pytest plugins are not supported;
the classroom tests use assertions.

Writes JSON to /work/.lc3-report.json:
  {"status": "ok"|"compile_error"|"error", "tests": [{"name","passed"}]}
"""

import io
import json
import os
import sys
import traceback

WORK = "/work"
REPORT = "/work/.lc3-report.json"


def main():
    # 1. slurp + compile every test file, then remove its source from disk
    test_sources = {}
    for name in sorted(os.listdir(WORK)):
        if name.startswith("test_") and name.endswith(".py"):
            path = os.path.join(WORK, name)
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    test_sources[name] = f.read()
            except OSError:
                continue
            try:
                os.remove(path)  # gone before any student code runs
            except OSError:
                pass

    if not test_sources:
        write({"status": "error", "tests": []})
        return

    compiled = {}
    for name, src in test_sources.items():
        try:
            compiled[name] = compile(src, "<" + name + ">", "exec")
        except SyntaxError:
            # a broken private test is an author error, not a student failure
            write({"status": "error", "tests": []})
            return

    sys.path.insert(0, WORK)

    # 2. run each test file's test_* functions; the first import of the
    # student module happens here, after the test source is already deleted
    results = []
    status = "ok"
    devnull = io.StringIO()
    for name, code in compiled.items():
        module_ns = {"__name__": "lc3_" + name[:-3]}
        try:
            old_out, old_err = sys.stdout, sys.stderr
            sys.stdout = sys.stderr = devnull
            try:
                exec(code, module_ns)
            finally:
                sys.stdout, sys.stderr = old_out, old_err
        except Exception:
            # importing the student module (or a test) blew up: syntax error
            # or exception at module scope counts as a compile-ish failure
            status = "compile_error"
            continue
        for attr in sorted(module_ns):
            if not attr.startswith("test_"):
                continue
            fn = module_ns[attr]
            if not callable(fn):
                continue
            passed = True
            try:
                old_out, old_err = sys.stdout, sys.stderr
                sys.stdout = sys.stderr = devnull
                try:
                    fn()
                finally:
                    sys.stdout, sys.stderr = old_out, old_err
            except Exception:
                passed = False
            results.append({"name": name[:-3] + "." + attr, "passed": passed})

    if not results and status == "ok":
        status = "compile_error"
    write({"status": status, "tests": results})


def write(obj):
    with open(REPORT, "w") as f:
        json.dump(obj, f)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            with open(REPORT, "w") as f:
                json.dump({"status": "error", "tests": [],
                           "trace": traceback.format_exc()[-500:]}, f)
        except OSError:
            pass
