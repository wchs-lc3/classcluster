# Sample assignments

Upload one of these zips from the Class Management view (Assignments -> Upload),
after creating a class of the matching language.

- `hello-py.zip` - Python. Make `greet(name)` return `Hello, <name>!`.
- `hello-java.zip` - Java. Make `Greeter.greet(name)` return `Hello, <name>!`.

Zip layout, if you make your own:

    assignment.json   {"id": "...", "title": "...", "timeout_sec": 15}   (optional)
    starter/...       files the student receives
    tests/...         private tests (test_*.py, or *Test.java with JUnit)
