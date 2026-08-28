# LC3: Lightweight Classroom Coding Cluster

A browser IDE and grading cluster for AP CS A (Java) and CP3 (Python), built to
run a 25-student classroom from one Raspberry Pi 4 gateway plus optional
Raspberry Pi 3 workers.

Students open one address, sign in, and land in VS Code in the browser. They
write code, press Run, and the program executes in their own browser with its
output in the integrated terminal. Submitting an assignment sends the code to
the cluster, where it is graded against private tests in a sandbox; students get
back pass/fail per test and nothing else. Everything happens on the one page:
no separate login, run, or admin screens.

## Quick start

On the Pi 4 (Arch Linux ARM, as root, repo at /opt/lc3):

    bash /opt/lc3/deploy/install_pi4.sh

Then open `http://<pi4-ip>/` and sign in as `teacher` (password `lc3teach`). A
fresh install has only that account. Create classes and students and upload
assignments from the Class Management view; sample assignment zips are in
`examples/`.

## How a class works

Each class has one language. A student belongs to one class and loads only that
language's runtime: Pyodide in the browser for Python, a real JVM in the cluster
for Java. A student sees only
their class's assignments. The teacher creates classes, adds students (one at a time or in bulk from a
`username,password` CSV), and uploads assignments from the Class Management view
inside the editor (an entry in the activity bar, teacher accounts only). One
assignment can be published to several classes of the same language at once.

## Capabilities

- One page: the login form, the VS Code workbench, and the runtime all live at
  the same address. Students never navigate anywhere else. The editor is trimmed
  to what a class needs: no Source Control, Run and Debug, Extensions, or Search.
- Run in the terminal, with real input: pressing Run executes the open file and
  streams its output into the integrated terminal, waiting for keyboard input as
  the program reads it. Python runs in the browser on Pyodide; Java compiles and
  runs on a real JVM in the cluster (so `Scanner`/`System.in` actually block),
  distributed to the workers with the gateway used last.
- Errors in the editor: syntax errors show as red squiggles and in the Problems
  panel as you save (Python via Pyodide, Java via a bundled JS parser, both in
  the browser); runtime errors highlight the line and print the trace in the
  terminal. Format Document works offline too: black for Python, prettier for
  Java, both in the browser.
- Submit is a self-check: it grades the code against the private tests and
  returns pass/fail per test, so a student can see whether their solution is
  correct. Grading runs in a bwrap + systemd sandbox (no network, no filesystem
  beyond its job directory, memory and process caps, a hard timeout); the test
  source is deleted before student code runs, so it cannot read the answers.
- Teacher grading portal: the grade is the teacher's, not the tests'. From the
  Class Management view the teacher recalls an assignment (snapshots every
  student's code), reads it read-only, and records a score and comment. Publish
  and unpublish open and close an assignment; unpublished work stays for grading.
- Authoring on the device: the teacher can run both Python and Java, write an
  assignment's `starter/` and `tests/` in their own files, and turn that folder
  into a published assignment without any external zip tool (or upload a zip).
  Assignments can be deleted, and student passwords reset, from the same view.
- Start from a working assignment: New Assignment from Template drops a small
  assignment into the teacher's files that already passes, with the starter
  students receive, the private tests, and a worked answer to check them
  against. Editing something that runs beats filling in an empty folder.
- Rehearse before publishing: a teacher pressing Submit runs the starter against
  the tests through the same grading path a student's submission takes, on the
  same workers, so what they see is what the class will see. A teacher's run is
  not recorded as a grade.
- Cluster distribution: grading and interactive runs go to the Pi 3 workers
  first; the gateway's own runner is used last. Adding a Pi 3 from the admin
  view provisions it over SSH and expands the pool; a Pi flashed with the
  balenaOS worker image joins on its own instead, and is configured from the
  balenaCloud dashboard (`balena/README.md`).
- See what each node is carrying: the Workers section lists every node with the
  runs it is holding out of the runs it accepts, its CPU load, and its free
  memory, so a class that has gone slow can be traced to the node causing it.
- A shell on a worker, for when the numbers are not enough. The teacher opens a
  terminal on any node from the Workers section and gets a real login shell
  there. It is off until a shell token is configured; see below.

## Turning on the worker shell

The shell gives a teacher root on the node they open it on, so it does not exist
until you decide it should. Set `LC3_SHELL_TOKEN` to the same value on the
gateway and on every node you want reachable, and restart them. A node without
the variable has no shell endpoint at all, and the Workers section says so.

On the gateway and a provisioned Pi 3 the variable goes in the systemd unit
(`deploy/lc3-api.service`, `deploy/lc3-runner.service`); on a balena worker it is
a fleet or device variable in the balenaCloud dashboard.

Only signed-in teachers can reach it, and only for nodes the gateway already
knows. Leave it unset if you do not want it.

## Known limitations

- Java runs on a real JVM in the cluster, so a Java Run uses gateway/worker
  CPU and memory (capped per node and scaled to its RAM). Java targets Java 8 to
  match the AP CS A course. Python runs on the student's own machine.
- Editor error checking: Python syntax is checked in the browser as you save;
  Java compile errors come from the cluster's `javac` when you Run.
- Submit returns test names and pass/fail only. Students see compile and runtime
  errors through Run, not Submit.
- Student code and the private tests run in one process during grading. Deleting
  the test source blocks reading it from disk, but a very advanced student could
  still introspect in-memory objects; closing that fully needs out-of-process
  grading, which this does not do.
- The worker shell is a plain root shell, not a restricted one, and it is not
  sandboxed; a shell that could not see the service logs would not answer the
  question it was opened to answer. It is off unless you configure a token.

## Layout

- `server/` gateway API (`lc3d`, Go, single static binary): auth, classes,
  files, grading dispatch, the run/stdin relay, worker provisioning. State is a
  SQLite database.
- `worker/` grading runner and sandbox; runs on workers and on the gateway.
- `ext/lc3/` the VS Code web extension: server-backed files, Run in the
  terminal, Submit, diagnostics, and the teacher's native Class Management view.
- `web/` the single-page shell (`index.html`) and the hidden runtime host.
- `deploy/` nginx config, systemd units, installer, sync script.
- `balena/` the same worker as a balenaOS fleet: `docker-compose.yml` in the
  repo root, one image for grading and one for the asset mirror, every setting
  a balenaCloud variable. A balena worker registers itself with the gateway by
  heartbeat, so it needs no SSH provisioning from the admin view. See
  `balena/README.md`.
- `vendor/` the trimmed vscode-web static build.
