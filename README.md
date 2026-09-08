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
for Java. A student sees only their class's assignments. The teacher creates classes and uploads assignments
from the Class Management view inside the editor (an entry in the activity bar,
teacher accounts only). One assignment can be published to several classes of
the same language at once, and which classes it is for can be changed later:
adding a class hands it to those students immediately, and removing one takes it
back, keeping a copy of what they had done.

Whoever joins a class gets whatever that class already has. That holds however
they arrive: a student who signs up with the code, a student the teacher adds by
hand, and a student moved into the class from another one all land on the
class's published assignments with nothing to republish.

Students make their own accounts. Each class has a join code; the teacher opens
sign-ups, reads the code out, and the class creates accounts from the login page
and lands straight in the editor with that class's work already in their files.
There is no roster to prepare and no list of passwords to hand round. Sign-ups
are closed until the teacher opens them, and closing them again afterwards is
the usual habit. A code that gets out is replaced from the same view, which
retires the old one immediately.

## Capabilities

- One page: the login form, the VS Code workbench, and the runtime all live at
  the same address. Students never navigate anywhere else. The editor is trimmed
  to what a class needs: no Source Control, Run and Debug, Extensions, or Search.
- Run in the terminal, with real input: pressing Run executes the open file and
  streams its output into the integrated terminal, waiting for keyboard input as
  the program reads it. Each Run starts on a cleared terminal. Python runs in
  the browser on Pyodide; Java compiles and runs on a real JVM in the cluster
  (so `Scanner`/`System.in` actually block), distributed to the workers with the
  gateway used last.
- Errors in the editor: syntax errors show as red squiggles and in the Problems
  panel as you save (Python via Pyodide, Java via a bundled JS parser, both in
  the browser); runtime errors highlight the line and print the trace in the
  terminal. Format Document works offline too: black for Python, prettier for
  Java, both in the browser.
- Submit is a self-check: it grades the code against the private tests and
  returns pass/fail per test, so a student can see whether their solution is
  correct. Tests are of two kinds, and an assignment can mix them: unit tests
  that call the student's functions (pytest-style `test_*.py`, or JUnit), and
  input/output cases that run the whole program with a given input and compare
  what it prints, line for line, with the expected output. A program written
  as a script, with no functions and no main guard, is graded by the cases;
  one that mixes top-level code and functions still imports for the unit
  tests. Grading runs in a bwrap + systemd sandbox (no network, no filesystem
  beyond its job directory, memory and process caps, a hard timeout); the test
  files are deleted before student code runs, so it cannot read the answers.
- Debugging Python: breakpoints, step in, over and out, the call stack, and the
  values of variables while the program is stopped. It runs in the browser, on
  the student's own machine, so a class debugging at once costs the cluster
  nothing. Java is not debugged yet; run it instead.
- Due dates: an assignment can carry one. Work handed in after it is still
  graded and still reaches the teacher, marked late; the student is told at the
  moment they submit. Closing an assignment for real is Unpublish, which stays a
  decision the teacher makes rather than something a clock does.
- Pasting can be turned off per assignment, for the exercise where typing it out
  is the point. Students can still copy and paste within their own files.
- Joining a class: a code per class, sign-ups opened and closed by the teacher,
  and accounts students create themselves. A wrong code is refused without
  saying whether it was the code or a closed class that was wrong, and an
  address that keeps guessing stops being answered.
- Reading the class's work: from the Class Management view the teacher recalls
  an assignment, which snapshots every student's code, and reads it read-only
  alongside how that student's last submission scored against the tests. The
  play button on a student's row copies their work into the teacher's own
  files instead, under `review/`, where Run, typed input, the debugger and
  editing all work on it: the way to try the case the tests did not cover.
  The grade itself goes in the school's gradebook; this device stores no scores
  and no comments. Publish and unpublish open and close an assignment;
  unpublished work stays readable.
- Authoring on the device: the teacher can run both Python and Java, write an
  assignment's `starter/` and `tests/` in their own files, and turn that folder
  into an assignment without any external zip tool (or upload a zip). The
  folder can sit anywhere in the teacher's files, a unit folder holding
  several assignments included; the assignment is named after it. A new
  assignment is unpublished until the teacher presses Publish. Creating it
  again from the same folder, or uploading the same id again, replaces the
  tests and the starter while students keep the work they have, so tests can
  be fixed after the class has started; any starter file a student is missing
  is handed to them. What the assignment is, when it is due, whether it takes
  pastes, and which file the input/output cases run live in an
  `assignment.yaml` beside those folders, and the due date and the paste setting
  can also be changed later from the Class Management view. Assignments can be
  deleted, and student passwords reset, from the same view.
- Start from a working assignment: New Assignment from Template drops a small
  assignment into the teacher's files that already passes, with the starter
  students receive, the private tests, and a worked answer to check them
  against. Editing something that runs beats filling in an empty folder.
- Rehearse before publishing: a teacher pressing Submit runs the starter against
  the tests through the same grading path a student's submission takes, on the
  same workers, so what they see is what the class will see. With a file from
  `solution/` open, Submit grades the worked answer instead, which is how to
  check that the tests can be passed. When grading could not run at all, the
  teacher is told why in one line: no test files in `tests/`, a test that
  would not import, a syntax error. Students get pass and fail per test and
  nothing else. A teacher's run is not recorded as a submission.
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
- An input/output case compares printed lines exactly, apart from trailing
  spaces and trailing blank lines. Spelling, punctuation and spacing inside a
  line all count, prompts included, so the expected output has to be written
  the way the assignment asks for it.
- On a touch screen the page zooms with a pinch; the browser's own zoom keys
  and full-screen key (F11) apply as on any page. There is no zoom setting
  inside the editor.
- Submit returns test names and pass/fail only. Students see compile and runtime
  errors through Run, not Submit.
- Debugging is Python only. There is no Java debugger; a Java program is run and
  read instead. The Python debugger stops on breakpoints and on steps, not on an
  uncaught exception, and it cannot interrupt a program that is already running:
  set the breakpoint before starting it.
- Turning pasting off is a speed bump, not a boundary. It refuses clipboard
  content that was not copied inside the editor, which stops the paste from a
  browser tab or a phone; a student who opens the browser's developer tools can
  get around it. Treat it as a nudge for an exercise, not as exam control.
- The device stores no grades. Scores and comments belong in the school's
  gradebook; a database written before this stops being true has its grades
  deleted the first time the gateway starts.
- Student code and the private tests run in one process during grading. Deleting
  the test source blocks reading it from disk, but a very advanced student could
  still introspect in-memory objects; closing that fully needs out-of-process
  grading, which this does not do.
- Sign-ups are open to anyone who can reach the login page and has the code.
  On a classroom LAN that is the point; the teacher decides when the door is
  open. Close sign-ups once the class is in.
- The worker shell is a plain root shell, not a restricted one, and it is not
  sandboxed; a shell that could not see the service logs would not answer the
  question it was opened to answer. It is off unless you configure a token.

## Layout

- `server/` gateway API (`lc3d`, Go, single static binary): auth, classes,
  files, grading dispatch, the run/stdin relay, worker provisioning. State is a
  SQLite database.
- `worker/` grading runner and sandbox; runs on workers and on the gateway.
- `ext/lc3/` the VS Code web extension: server-backed files, Run in the
  terminal, Submit, the Python debugger, diagnostics, and the teacher's native
  Class Management view.
- `web/` the single-page shell (`index.html`) and the hidden runtime host.

The extension and the Python worker are written in LiveScript and compiled in
the browser as they load, so there is still no build step: edit the `.ls` file,
reload the page. The `.js` beside each one is the few lines that fetch the
compiler and run the result.
- `deploy/` nginx config, systemd units, installer, sync script.
- `balena/` the same worker as a balenaOS fleet: `docker-compose.yml` in the
  repo root, one image for grading and one for the asset mirror, every setting
  a balenaCloud variable. A balena worker registers itself with the gateway by
  heartbeat, so it needs no SSH provisioning from the admin view. See
  `balena/README.md`.
- `vendor/` the trimmed vscode-web static build.
