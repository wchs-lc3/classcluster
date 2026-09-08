# Sample assignments

Upload one of these zips from the Class Management view (Assignments -> Upload),
after creating a class of the matching language.

- `hello-py.zip` - Python. Make `greet(name)` return `Hello, <name>!`.
- `hello-java.zip` - Java. Make `Greeter.greet(name)` return `Hello, <name>!`.

Zip layout, if you make your own:

    assignment.yaml   settings (optional; see below)
    starter/...       files the student receives
    tests/...         private tests, of either or both kinds:
                        test_*.py or *_test.py, or *Test.java with JUnit  (unit tests)
                        <case>.out with an optional <case>.in (input/output)

An input/output case runs the student's program whole, feeding it `<case>.in`
as typed input (nothing, if there is no .in), and compares everything it
prints with `<case>.out`, line for line. Trailing spaces and trailing blank
lines are ignored; prompts are part of the output. A student's file needs no
functions and no main guard for this kind. Which file is run comes from
`entry` in assignment.yaml, or main.py, or the one program file there is.

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
    entry: main.py           # the file the input/output cases run

The same layout as a folder in the teacher's own files, anywhere in them (a
unit folder holding several assignments is fine), becomes an assignment with
Create from folder; it is named after the folder unless an id is given.

An uploaded assignment starts unpublished; press Publish when the class should
see it. Uploading a zip with the same id again replaces the tests and the
starter, keeps whether it is published, and leaves every student's work alone.

A folder written before this file was YAML still has `assignment.json`, which
is still read.
