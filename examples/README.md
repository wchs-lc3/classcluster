# Sample assignments

Upload one of these zips from the Class Management view (Assignments -> Upload),
after creating a class of the matching language.

- `hello-py.zip` - Python. Make `greet(name)` return `Hello, <name>!`.
- `hello-java.zip` - Java. Make `Greeter.greet(name)` return `Hello, <name>!`.

Zip layout, if you make your own:

    assignment.yaml   settings (optional; see below)
    starter/...       files the student receives
    tests/...         private tests (test_*.py, or *Test.java with JUnit)

Zipping the folder itself rather than its contents is fine: one wrapping
directory is stripped on upload.

`assignment.yaml` holds what the assignment is and how it runs. Every key is
optional:

    id: hello-py
    title: Hello (Python)
    language: python
    timeout_sec: 15
    due: 2026-09-14 23:59    # or a plain date for the end of that day
    no_paste: false          # true stops pasting from outside the editor

A folder written before this file was YAML still has `assignment.json`, which
is still read.
