#!/bin/bash
# API end-to-end tests against a running gateway (default the Pi 4). A fresh
# install seeds only the teacher, so the suite first bootstraps as the teacher
# (create classes, add students, upload the sample assignment zips), then runs
# the student-facing checks: single-runtime language, per-class visibility, the
# filesystem, the run/stdin relay, grading through the cluster, and the sandbox
# guarantees. Bootstrapped data is left in place for manual poking.
set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${1:-${LC3_BASE:-}}"
if [ -z "$BASE" ]; then
    echo "usage: $0 <gateway-url>   (or set LC3_BASE)" >&2
    exit 2
fi
BASE_HOST=$(echo "$BASE" | sed -E 's#https?://##; s#[:/].*##')
JT=/tmp/lc3-jt; J=/tmp/lc3-jd; JS=/tmp/lc3-js
pass=0; fail=0
ok()  { echo "  ok   - $1"; pass=$((pass+1)); }
bad() { echo "  FAIL - $1"; fail=$((fail+1)); }
chk() { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (want '$2' got '$1')"; fi; }
has() { echo "$1" | grep -q "$2" && ok "$3" || bad "$3 : $1"; }

login() { # jar user pass
  curl -s -c "$1" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$2\",\"password\":\"$3\"}" $BASE/api/login >/dev/null
}
tpost() { # path json
  curl -s -b $JT -H 'Content-Type: application/json' -d "$2" "$BASE$1"
}
upload_zip() { # class zipfile
  local b64; b64=$(base64 -w0 "$2")
  printf '{"class":"%s","zip_b64":"%s"}' "$1" "$b64" > /tmp/lc3-up.json
  curl -s -b $JT -H 'Content-Type: application/json' --data @/tmp/lc3-up.json \
    $BASE/api/admin/assignments/upload
}

echo "== bootstrap: teacher creates classes, students, assignments =="
code=$(curl -s -o /dev/null -w '%{http_code}' -c $JT -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"lc3teach"}' $BASE/api/login)
chk "$code" "200" "teacher login"
has "$(tpost /api/admin/classes '{"id":"cp3","name":"CP3 Python","lang":"python"}')" '"ok":true' "create class cp3 (python)"
has "$(tpost /api/admin/classes '{"id":"apcsa","name":"AP CS A","lang":"java"}')" '"ok":true' "create class apcsa (java)"
has "$(tpost /api/admin/students '{"username":"demo","password":"demo","class":"cp3"}')" '"ok":true' "add student demo -> cp3"
has "$(tpost /api/admin/students '{"username":"sj","password":"sj","class":"apcsa"}')" '"ok":true' "add student sj -> apcsa"
tpost /api/admin/assignments/delete '{"id":"hello-py"}' >/dev/null   # so a rerun still sees a fresh one
up=$(upload_zip cp3 "$DIR/examples/hello-py.zip")
has "$up" '"ok":true' "upload hello-py.zip to cp3"
has "$up" '"closed":true' "a new assignment starts unpublished"
has "$(upload_zip apcsa "$DIR/examples/hello-java.zip")" '"ok":true' "upload hello-java.zip to apcsa"
tpost /api/admin/assignments/publish '{"id":"hello-py"}' >/dev/null
tpost /api/admin/assignments/publish '{"id":"hello-java"}' >/dev/null

echo "== auth =="
code=$(curl -s -o /dev/null -w '%{http_code}' -c $J -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"demo"}' $BASE/api/login)
chk "$code" "200" "student login"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"wrong"}' $BASE/api/login)
chk "$code" "401" "bad password rejected"
chk "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/me)" "401" "no cookie is unauthorized"

echo "== single runtime language from class =="
me=$(curl -s -b $J $BASE/api/me)
has "$me" '"lang":"python"' "cp3 student runtime is python"
has "$me" '"class":"cp3"' "cp3 student has class"
login $JS sj sj
has "$(curl -s -b $JS $BASE/api/me)" '"lang":"java"' "apcsa student runtime is java"

echo "== per-class assignment visibility =="
da=$(curl -s -b $J $BASE/api/assignments)
has "$da" 'hello-py' "cp3 student sees hello-py"
echo "$da" | grep -q 'hello-java' && bad "cp3 student must not see java assignment" || ok "cp3 student does not see java assignment"
has "$(curl -s -b $JS $BASE/api/assignments)" 'hello-java' "apcsa student sees hello-java"

echo "== student filesystem =="
curl -s -b $J -X POST "$BASE/api/fs/mkdir?path=/scratch" >/dev/null
curl -s -b $J -X POST --data-binary 'print(6*7)' "$BASE/api/fs/write?path=/scratch/a.py" >/dev/null
chk "$(curl -s -b $J "$BASE/api/fs/read?path=/scratch/a.py")" "print(6*7)" "write then read file"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $J "$BASE/api/fs/read?path=/../../etc/passwd")" "400" "path traversal blocked"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $JS "$BASE/api/fs/read?path=/scratch/a.py")" "404" "students are isolated from each other"

echo "== run/stdin relay =="
curl -s -b $J -X POST --data-binary 'Ada' "$BASE/api/run/stdin?run=testrun" >/dev/null
chk "$(curl -s -b $J "$BASE/api/run/stdin?run=testrun")" "Ada" "stdin line posted then polled back"

echo "== grading: python pass (cluster path) =="
curl -s -b $J -X POST --data-binary "def greet(name):
    return 'Hello, ' + name + '!'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
echo "  -> $res"
{ echo "$res" | grep -q '"passed":3' && echo "$res" | grep -q '"failed":0'; } && ok "correct python passes 3/3" || bad "python pass: $res"

echo "== grading: python fail =="
curl -s -b $J -X POST --data-binary "def greet(name):
    return 'nope'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
has "$res" '"passed":0' "wrong python solution fails"
echo "$res" | grep -qi 'assert\|Hello, World' && bad "grade output leaks test internals" || ok "grade output carries no test source"

echo "== sandbox: cannot read private tests =="
curl -s -b $J -X POST --data-binary "import os
_found=[]
for r,d,fs in os.walk('/'):
    for f in fs:
        if f.startswith('test_') and f.endswith('.py'): _found.append(f)
def greet(name):
    return ('Hello, ' + name + '!') if not _found else 'FOUND_TESTS'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
has "$res" '"passed":3' "test source deleted before student code runs"

echo "== sandbox: network exfiltration blocked =="
curl -s -b $J -X POST --data-binary "import socket
def greet(name):
    try:
        socket.create_connection(('$BASE_HOST', 22), timeout=2); return 'Hello, ' + name + '!'
    except Exception: return 'NET_BLOCKED'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
has "$res" '"passed":0' "sandboxed code cannot open a network socket"

echo "== sandbox: infinite loop hits timeout =="
curl -s -b $J -X POST --data-binary "def greet(name):
    while True: pass
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
t0=$(date +%s)
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
t1=$(date +%s)
echo "  -> $res ($((t1-t0))s)"
has "$res" 'timeout' "infinite loop reported as timeout"
[ $((t1-t0)) -lt 60 ] && ok "timeout enforced under 60s" || bad "timeout took too long"

echo "== grading: java pass and compile error =="
curl -s -b $JS -X POST --data-binary 'public class Greeter {
    public static String greet(String name) { return "Hello, " + name + "!"; }
    public static void main(String[] a) {}
}' "$BASE/api/fs/write?path=/hello-java/Greeter.java" >/dev/null
res=$(curl -s -b $JS -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-java"}' $BASE/api/submit)
echo "  -> $res"
{ echo "$res" | grep -q '"passed":2' && echo "$res" | grep -q '"failed":0'; } && ok "correct java passes 2/2" || bad "java pass: $res"
curl -s -b $JS -X POST --data-binary 'public class Greeter { this is not java }' \
  "$BASE/api/fs/write?path=/hello-java/Greeter.java" >/dev/null
res=$(curl -s -b $JS -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-java"}' $BASE/api/submit)
has "$res" 'compile_error' "java compile error detected"

echo "== interactive java run (real JVM, blocks on input) =="
curl -s -b $JS -X POST "$BASE/api/fs/mkdir?path=/run" >/dev/null
curl -s -b $JS -X POST --data-binary 'import java.util.Scanner;
public class Echo {
  public static void main(String[] a){
    Scanner s=new Scanner(System.in);
    System.out.print("name? ");
    System.out.println("HELLO_"+s.nextLine());
  }
}' "$BASE/api/fs/write?path=/run/Echo.java" >/dev/null
start=$(curl -s -b $JS -H 'Content-Type: application/json' -d '{"path":"/run/Echo.java"}' $BASE/api/run/exec/start)
xrun=$(echo "$start" | sed -E 's/.*"run":"([^"]+)".*/\1/')
has "$start" '"status":"running"' "interactive run starts on a runner"
o1=$(curl -s -b $JS -H 'Content-Type: application/json' "$BASE/api/run/exec/output?run=$xrun&since=0")
{ echo "$o1" | grep -q 'name?' && echo "$o1" | grep -q '"done":false'; } && ok "program prints prompt and waits for input" || bad "exec wait: $o1"
curl -s -b $JS -X POST --data-binary 'World' "$BASE/api/run/exec/input?run=$xrun" >/dev/null
o2=""
for i in $(seq 8); do
  o2=$(curl -s -b $JS -H 'Content-Type: application/json' "$BASE/api/run/exec/output?run=$xrun&since=6")
  echo "$o2" | grep -q '"done":true' && break
  sleep 1
done
{ echo "$o2" | grep -q 'HELLO_World' && echo "$o2" | grep -q '"done":true'; } && ok "input resumes the program to completion" || bad "exec resume: $o2"

echo "== java compile-for-run endpoint =="
curl -s -b $JS -X POST "$BASE/api/fs/mkdir?path=/javarun" >/dev/null
curl -s -b $JS -X POST --data-binary 'public class Hi { public static void main(String[] a){ System.out.println("hi"); } }' \
  "$BASE/api/fs/write?path=/javarun/Hi.java" >/dev/null
res=$(curl -s -b $JS -X POST -H 'Content-Type: application/json' -d '{"path":"/javarun/Hi.java","entry":"Hi.java"}' $BASE/api/compile-java)
{ echo "$res" | grep -q '"status":"ok"' && echo "$res" | grep -q '"classes"'; } && ok "java compiles to class files for the browser" || bad "compile-java: $res"

echo "== authorization =="
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $J $BASE/api/admin/students)" "403" "student blocked from admin students"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $J $BASE/api/admin/classes)" "403" "student blocked from admin classes"

echo "== teacher: reassign class + delete round-trip =="
tpost /api/admin/students/setclass '{"username":"demo","class":"apcsa"}' >/dev/null
has "$(curl -s -b $JT $BASE/api/admin/students)" '"class":"apcsa","role":"student","username":"demo"' "teacher moved demo to apcsa"
tpost /api/admin/students/setclass '{"username":"demo","class":"cp3"}' >/dev/null
has "$(curl -s -b $JT $BASE/api/admin/workers)" '"local":true' "gateway registered as a local worker"
chk "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"id":"x","token":"WRONG"}' $BASE/api/worker/heartbeat)" "403" "worker heartbeat rejects a bad token"

echo "== students create their own accounts with a class code =="
signup() { # code user pass -> body, into the jar named first
    curl -s -c "$1" -X POST -H 'Content-Type: application/json' \
        -d "{\"code\":\"$2\",\"username\":\"$3\",\"password\":\"$4\"}" $BASE/api/signup
}
tpost /api/admin/classes '{"id":"joincls","name":"Join","lang":"python"}' >/dev/null
code=$(curl -s -b $JT $BASE/api/admin/classes |
    python3 -c 'import sys,json;print([c["code"] for c in json.load(sys.stdin)["classes"] if c["id"]=="joincls"][0])')
[ -n "$code" ] && ok "a new class is given a join code" || bad "no join code on a new class"
# Closed by default: a code alone is not enough.
has "$(signup /tmp/lc3-js1 "$code" joinkid pw123456)" 'not accepting' "sign-ups are closed until the teacher opens them"
tpost /api/admin/classes/signup '{"id":"joincls","open":true}' >/dev/null
has "$(signup /tmp/lc3-js1 ZZZZ-ZZZZ joinkid pw123456)" 'not accepting' "a wrong code is refused"
has "$(signup /tmp/lc3-js1 "$code" joinkid short)" 'at least 6' "a too-short password is refused"
# The dash and the case are cosmetic, so a student who drops them still gets in.
loose=$(echo "$code" | tr 'A-Z' 'a-z' | tr -d '-')
has "$(signup /tmp/lc3-js1 "$loose" joinkid pw123456)" '"class":"joincls"' "the right code creates the account"
has "$(curl -s -b /tmp/lc3-js1 $BASE/api/me)" '"username":"joinkid"' "signing up signs the student in"
has "$(signup /tmp/lc3-js2 "$code" joinkid pw123456)" 'taken' "a taken username is refused"
# A new code retires the old one, which is how a leaked code is dealt with.
newcode=$(tpost /api/admin/classes/code '{"id":"joincls"}' |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["code"])')
has "$(signup /tmp/lc3-js2 "$code" joinkid2 pw123456)" 'not accepting' "the old code stops working"
has "$(signup /tmp/lc3-js2 "$newcode" joinkid2 pw123456)" '"class":"joincls"' "the new code works"
tpost /api/admin/classes/signup '{"id":"joincls","open":false}' >/dev/null
has "$(signup /tmp/lc3-js3 "$newcode" joinkid3 pw123456)" 'not accepting' "closing sign-ups shuts the door again"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $J -X POST -H 'Content-Type: application/json' \
    -d '{"id":"joincls"}' $BASE/api/admin/classes/code)" "403" "a student cannot reroll a class code"
# Guessing at codes is what the limiter is for: a run of wrong ones stops
# being answered long before it could work through the code space.
tpost /api/admin/classes/signup '{"id":"joincls","open":true}' >/dev/null
limited=no
for i in $(seq 1 25); do
    st=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
        -d '{"code":"ZZZZ-ZZZZ","username":"guess'"$i"'","password":"pw123456"}' $BASE/api/signup)
    [ "$st" = "429" ] && { limited=yes; break; }
done
[ "$limited" = yes ] && ok "a run of wrong codes gets rate limited" || bad "wrong codes were never rate limited"
# The teacher can lift a lockout, so a student who fumbled the code is not
# stuck for the rest of the window (and this suite can run twice in a row).
tpost /api/admin/signup/unlock '{}' >/dev/null
tpost /api/admin/classes/signup '{"id":"joincls","open":true}' >/dev/null
has "$(signup /tmp/lc3-js4 "$newcode" joinkid4 pw123456)" '"class":"joincls"' "clearing the lockout lets sign-ups through again"
for u in joinkid joinkid2 joinkid4; do tpost /api/admin/students/delete "{\"username\":\"$u\"}" >/dev/null; done
tpost /api/admin/classes/delete '{"id":"joincls"}' >/dev/null

echo "== teacher: one assignment across multiple classes =="
tpost /api/admin/classes '{"id":"secb","name":"Sec B","lang":"python"}' >/dev/null
tpost /api/admin/students '{"username":"sb","password":"sb","class":"secb"}' >/dev/null
B64=$(base64 -w0 "$DIR/examples/hello-py.zip")
printf '{"classes":["cp3","secb"],"zip_b64":"%s"}' "$B64" > /tmp/lc3-mc.json
has "$(curl -s -b $JT -H 'Content-Type: application/json' --data @/tmp/lc3-mc.json $BASE/api/admin/assignments/upload)" '"ok":true' "assignment uploaded to two classes"
login /tmp/lc3-jsb sb sb
has "$(curl -s -b /tmp/lc3-jsb $BASE/api/assignments)" 'hello-py' "second-class student sees the shared assignment"
printf '{"classes":["cp3","apcsa"],"zip_b64":"%s"}' "$B64" > /tmp/lc3-mx.json
has "$(curl -s -b $JT -H 'Content-Type: application/json' --data @/tmp/lc3-mx.json $BASE/api/admin/assignments/upload)" 'same language' "mixed-language classes rejected"

echo "== a student joining a class gets that class's published work =="
tpost /api/admin/classes '{"id":"cls3","name":"Third","lang":"python"}' >/dev/null
tpost /api/admin/students '{"username":"kid3","password":"kid3pw","class":"cls3"}' >/dev/null
login /tmp/lc3-k3 kid3 kid3pw
k3=$(curl -s -b /tmp/lc3-k3 "$BASE/api/fs/list?path=/")
echo "$k3" | grep -q 'hello-py' && bad "a class with nothing published handed out an assignment" || ok "a new class starts with nothing published"
# The same assignment, now also for the new class.
res=$(tpost /api/admin/assignments/settings '{"id":"hello-py","classes":["cp3","secb","cls3"]}')
has "$res" '"published_to":1' "adding a class publishes the assignment to its students"
has "$(curl -s -b /tmp/lc3-k3 "$BASE/api/fs/list?path=/")" 'hello-py' "the student in the added class receives it"
has "$(curl -s -b $J $BASE/api/assignments)" 'hello-py' "and the original class keeps it"
# A student added after the fact gets it without anyone republishing.
tpost /api/admin/students '{"username":"kid4","password":"kid4pw","class":"cls3"}' >/dev/null
login /tmp/lc3-k4 kid4 kid4pw
has "$(curl -s -b /tmp/lc3-k4 "$BASE/api/fs/list?path=/")" 'hello-py' "a student added to the class later gets it too"
# Taking a class off the assignment takes the work back, but keeps a copy.
curl -s -b /tmp/lc3-k3 -X POST --data-binary "def greet(name):
    return 'kid3 was here'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
tpost /api/admin/assignments/settings '{"id":"hello-py","classes":["cp3","secb"]}' >/dev/null
echo "$(curl -s -b /tmp/lc3-k3 "$BASE/api/fs/list?path=/")" | grep -q 'hello-py' && bad "dropping a class left the assignment in place" || ok "dropping a class takes the assignment back"
has "$(curl -s -b $JT "$BASE/api/admin/collected/read?assignment=hello-py&user=kid3&path=main.py")" \
    'kid3 was here' "their work is snapshotted before it is taken back"
has "$(tpost /api/admin/assignments/settings '{"id":"hello-py","classes":["cp3","apcsa"]}')" \
    'not a python class' "a class of the wrong language is refused"
for u in kid3 kid4; do tpost /api/admin/students/delete "{\"username\":\"$u\"}" >/dev/null; done
tpost /api/admin/classes/delete '{"id":"cls3"}' >/dev/null

echo "== teacher: a zip of the folder itself uploads too =="
# Zipping a folder rather than its contents is what a file manager does by
# default, and it used to produce an assignment with no tests in it.
rm -rf /tmp/lc3-wrap && mkdir -p /tmp/lc3-wrap/wrapped
python3 - <<'PY'
import zipfile, os
src = zipfile.ZipFile('examples/hello-py.zip')
with zipfile.ZipFile('/tmp/lc3-wrap/wrapped.zip', 'w') as out:
    for name in src.namelist():
        data = src.read(name)
        if name.endswith('assignment.yaml'):
            data = data.replace(b'id: hello-py', b'id: wrapped')
        out.writestr('wrapped/' + name, data)
PY
WB64=$(base64 -w0 /tmp/lc3-wrap/wrapped.zip)
printf '{"classes":["cp3"],"zip_b64":"%s"}' "$WB64" > /tmp/lc3-wrapup.json
has "$(curl -s -b $JT -H 'Content-Type: application/json' --data @/tmp/lc3-wrapup.json $BASE/api/admin/assignments/upload)" \
    '"id":"wrapped"' "a zip with one wrapping folder is unwrapped"
has "$(curl -s -b $JT $BASE/api/assignments)" 'wrapped' "the unwrapped assignment exists"
tpost /api/admin/assignments/delete '{"id":"wrapped"}' >/dev/null

echo "== teacher: reset password =="
tpost /api/admin/students/setpassword '{"username":"demo","password":"newpw"}' >/dev/null
chk "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"username":"demo","password":"newpw"}' $BASE/api/login)" "200" "reset password lets the student log in"
tpost /api/admin/students/setpassword '{"username":"demo","password":"demo"}' >/dev/null

echo "== account: a user changes their own password =="
acctpw() { curl -s -o /dev/null -w '%{http_code}' -b "$1" -H 'Content-Type: application/json' -d "$2" $BASE/api/account/password; }
login /tmp/lc3-jt2 teacher lc3teach   # a second teacher session, to prove it gets dropped
chk "$(acctpw $JT '{"current":"WRONG","new":"betterpw1"}')" "403" "wrong current password is rejected"
chk "$(acctpw $JT '{"current":"lc3teach","new":"short"}')" "400" "too-short new password is rejected"
chk "$(acctpw $JT '{"current":"lc3teach","new":"betterpw1"}')" "200" "correct current password changes it"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/lc3-jt2 $BASE/api/admin/classes)" "401" "other sessions are signed out after a change"
chk "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"username":"teacher","password":"lc3teach"}' $BASE/api/login)" "401" "the old password no longer logs in"
login $JT teacher betterpw1
acctpw $JT '{"current":"betterpw1","new":"lc3teach"}' >/dev/null   # restore for later checks
login $JT teacher lc3teach

echo "== teacher: author an assignment on-site (from a folder) then delete it =="
curl -s -b $JT -X POST "$BASE/api/fs/mkdir?path=/mkasg/starter" >/dev/null
curl -s -b $JT -X POST "$BASE/api/fs/mkdir?path=/mkasg/tests" >/dev/null
curl -s -b $JT -X POST --data-binary 'def add(a,b): return 0' "$BASE/api/fs/write?path=/mkasg/starter/main.py" >/dev/null
curl -s -b $JT -X POST --data-binary 'import main
def test_add(): assert main.add(2,3)==5' "$BASE/api/fs/write?path=/mkasg/tests/test_main.py" >/dev/null
mk=$(tpost /api/admin/assignments/from-folder '{"folder":"/mkasg","id":"mkasg","classes":["cp3"]}')
has "$mk" '"ok":true' "create assignment from an authored folder"
has "$mk" '"updated":false' "and it is new"
echo "$(curl -s -b $J $BASE/api/assignments)" | grep -q mkasg && bad "an unpublished assignment reached the student" || ok "a new assignment is hidden until published"
tpost /api/admin/assignments/publish '{"id":"mkasg"}' >/dev/null
has "$(curl -s -b $J $BASE/api/assignments)" 'mkasg' "authored assignment reaches the student once published"

echo "== teacher: fixing the tests after the class has started =="
curl -s -b $J -X POST --data-binary 'def add(a,b): return a+b   # my work' "$BASE/api/fs/write?path=/mkasg/main.py" >/dev/null
curl -s -b $JT -X POST --data-binary 'import main
def test_add(): assert main.add(2,3)==5
def test_add_negative(): assert main.add(-1,1)==0' "$BASE/api/fs/write?path=/mkasg/tests/test_main.py" >/dev/null
curl -s -b $JT -X POST --data-binary 'x = 1' "$BASE/api/fs/write?path=/mkasg/starter/extra.py" >/dev/null
mk=$(tpost /api/admin/assignments/from-folder '{"folder":"/mkasg","id":"mkasg","classes":["cp3"]}')
has "$mk" '"updated":true' "creating again from the folder is an update"
has "$mk" '"closed":false' "an open assignment stays open through an update"
has "$(curl -s -b $J "$BASE/api/fs/read?path=/mkasg/main.py")" 'my work' "the student keeps their work"
chk "$(curl -s -b $J "$BASE/api/fs/read?path=/mkasg/extra.py")" "x = 1" "a starter file the student did not have is handed over"
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"mkasg"}' $BASE/api/submit)
has "$res" 'test_add_negative' "the new tests are the ones that run"
tpost /api/admin/assignments/unpublish '{"id":"mkasg"}' >/dev/null
mk=$(tpost /api/admin/assignments/from-folder '{"folder":"/mkasg","id":"mkasg","classes":["cp3"]}')
has "$mk" '"closed":true' "a closed assignment stays closed through an update"
tpost /api/admin/assignments/delete '{"id":"mkasg"}' >/dev/null
echo "$(curl -s -b $J $BASE/api/assignments)" | grep -q mkasg && bad "deleted assignment still visible" || ok "delete assignment removes it"

echo "== grading: input/output cases, and a script with no main guard =="
curl -s -b $JT -X POST "$BASE/api/fs/mkdir?path=/ioasg/starter" >/dev/null
curl -s -b $JT -X POST "$BASE/api/fs/mkdir?path=/ioasg/tests" >/dev/null
curl -s -b $JT -X POST --data-binary 'name = input("Name? ")
print("Hi " + name)' "$BASE/api/fs/write?path=/ioasg/starter/main.py" >/dev/null
curl -s -b $JT -X POST --data-binary 'Ada' "$BASE/api/fs/write?path=/ioasg/tests/greets.in" >/dev/null
curl -s -b $JT -X POST --data-binary 'Name? Hi Ada' "$BASE/api/fs/write?path=/ioasg/tests/greets.out" >/dev/null
printf '\n' | curl -s -b $JT -X POST --data-binary @- "$BASE/api/fs/write?path=/ioasg/tests/empty_name.in" >/dev/null
curl -s -b $JT -X POST --data-binary 'Name? Hi ' "$BASE/api/fs/write?path=/ioasg/tests/empty_name.out" >/dev/null
curl -s -b $JT -X POST --data-binary 'x' "$BASE/api/fs/write?path=/ioasg/tests/no_input_needed.out" >/dev/null
tpost /api/admin/assignments/from-folder '{"folder":"/ioasg","id":"ioasg","classes":["cp3"]}' >/dev/null
tpost /api/admin/assignments/publish '{"id":"ioasg"}' >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"ioasg"}' $BASE/api/submit)
echo "  -> $res"
has "$res" '"name":"io.greets","passed":true' "a script with input() and no functions passes its io case"
has "$res" '"name":"io.empty_name","passed":true' "an input of one blank line reads as an empty answer"
has "$res" '"name":"io.no_input_needed","passed":false' "a case with no .in gives the program nothing to read"
curl -s -b $J -X POST --data-binary 'name = input("Name? ")
print("Hello " + name)' "$BASE/api/fs/write?path=/ioasg/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"ioasg"}' $BASE/api/submit)
has "$res" '"name":"io.greets","passed":false' "output that differs fails the case"
echo "$res" | grep -q 'Hi Ada' && bad "grade output leaks the expected output" || ok "the expected output is not in the reply"
# Top-level code beside functions: the unit tests still reach the functions.
curl -s -b $JT -X POST --data-binary 'import main
def test_double(): assert main.double(4) == 8' "$BASE/api/fs/write?path=/ioasg/tests/test_main.py" >/dev/null
curl -s -b $JT -X POST --data-binary 'Name? Hi Ada
8' "$BASE/api/fs/write?path=/ioasg/tests/greets.out" >/dev/null
tpost /api/admin/assignments/from-folder '{"folder":"/ioasg","id":"ioasg","classes":["cp3"]}' >/dev/null
curl -s -b $J -X POST --data-binary 'def double(n):
    return n * 2
name = input("Name? ")
print("Hi " + name)
print(double(4))
exit()' "$BASE/api/fs/write?path=/ioasg/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"ioasg"}' $BASE/api/submit)
echo "  -> $res"
has "$res" '"name":"test_main.test_double","passed":true' "a unit test reaches a function in a file with top-level input() and exit()"
has "$res" '"name":"io.greets","passed":true' "and the io case still runs the whole program"
has "$res" '"status":"ok"' "with an ok status"
tpost /api/admin/assignments/delete '{"id":"ioasg"}' >/dev/null
curl -s -b $JT -X POST "$BASE/api/fs/delete?path=/ioasg" >/dev/null

echo "== grading: java input/output case beside junit =="
curl -s -b $JT -X POST "$BASE/api/fs/mkdir?path=/iojava/starter" >/dev/null
curl -s -b $JT -X POST "$BASE/api/fs/mkdir?path=/iojava/tests" >/dev/null
curl -s -b $JT -X POST --data-binary 'import java.util.Scanner;
public class Greet {
  public static String greet(String n) { return "Hi " + n; }
  public static void main(String[] a) {
    Scanner s = new Scanner(System.in);
    System.out.print("Name? ");
    System.out.println(greet(s.nextLine()));
  }
}' "$BASE/api/fs/write?path=/iojava/starter/Greet.java" >/dev/null
curl -s -b $JT -X POST --data-binary 'Ada' "$BASE/api/fs/write?path=/iojava/tests/greets.in" >/dev/null
curl -s -b $JT -X POST --data-binary 'Name? Hi Ada' "$BASE/api/fs/write?path=/iojava/tests/greets.out" >/dev/null
curl -s -b $JT -X POST --data-binary 'import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class GreetTest {
  @Test public void greets() { assertEquals("Hi Bob", Greet.greet("Bob")); }
}' "$BASE/api/fs/write?path=/iojava/tests/GreetTest.java" >/dev/null
tpost /api/admin/assignments/from-folder '{"folder":"/iojava","id":"iojava","classes":["apcsa"]}' >/dev/null
res=$(tpost /api/submit '{"assignment":"iojava"}')
echo "  -> $res"
has "$res" '"name":"io.greets","passed":true' "a java io case runs the class with main"
has "$res" '"name":"GreetTest.greets","passed":true' "beside the junit test"
tpost /api/admin/assignments/delete '{"id":"iojava"}' >/dev/null
curl -s -b $JT -X POST "$BASE/api/fs/delete?path=/iojava" >/dev/null

echo "== teacher: reading submissions (recall, read, unpublish) =="
curl -s -b $J -X POST --data-binary "def greet(name):
    return 'Hello, ' + name + '!'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
has "$(tpost /api/admin/assignments/recall '{"id":"hello-py"}')" '"collected"' "recall snapshots student code"
has "$(curl -s -b $JT "$BASE/api/admin/collected?assignment=hello-py")" '"username":"demo"' "collected lists the student"
has "$(curl -s -b $JT "$BASE/api/admin/collected/read?assignment=hello-py&user=demo&path=main.py")" 'greet' "teacher reads the student's actual code"
co=$(tpost /api/admin/collected/checkout '{"assignment":"hello-py","user":"demo"}')
has "$co" '"folder":"/review/hello-py/demo"' "the teacher can take a copy of a student's work into their own files"
has "$co" '"entry":"main.py"' "and is told which file to run"
has "$(curl -s -b $JT "$BASE/api/fs/read?path=/review/hello-py/demo/main.py")" 'greet' "the copy is a real file in the teacher's files"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $J -H 'Content-Type: application/json' -d '{"assignment":"hello-py","user":"demo"}' $BASE/api/admin/collected/checkout)" "403" "a student cannot take a copy"
# Scores are not kept on this device: there is nowhere to put one.
col=$(curl -s -b $JT "$BASE/api/admin/collected?assignment=hello-py")
echo "$col" | grep -q '"score"' && bad "collected still carries a score field" || ok "no grade is stored with the collected work"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $JT -H 'Content-Type: application/json' \
  -d '{"assignment":"hello-py","username":"demo","score":"A"}' $BASE/api/admin/grade)" "404" "the grade endpoint is gone"
tpost /api/admin/assignments/unpublish '{"id":"hello-py"}' >/dev/null
echo "$(curl -s -b $J "$BASE/api/fs/list?path=/")" | grep -q 'hello-py' && bad "unpublish left the folder in the student's files" || ok "unpublish removes the folder from the student's files"
has "$(curl -s -b $JT $BASE/api/assignments)" '"closed":true' "teacher sees it as closed"
tpost /api/admin/assignments/publish '{"id":"hello-py"}' >/dev/null
has "$(curl -s -b $J "$BASE/api/fs/list?path=/")" 'hello-py' "re-publish restores the folder in the student's files"

echo "== teacher: moving a student's class swaps their visible assignments =="
curl -s -b $J -X POST --data-binary "def greet(name):
    return 'Hello, ' + name + '!'   # the work being carried across the move
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
tpost /api/admin/students/setclass '{"username":"demo","class":"apcsa"}' >/dev/null
dl=$(curl -s -b $J "$BASE/api/fs/list?path=/")
has "$dl" 'hello-java' "moving demo to the java class adds the java assignment"
echo "$dl" | grep -q 'hello-py' && bad "old python assignment still present after class switch" || ok "and removes the python assignment"
# Taking the folder away must not throw the work away with it.
has "$(curl -s -b $JT "$BASE/api/admin/collected/read?assignment=hello-py&user=demo&path=main.py")" \
    'carried across the move' "work is snapshotted before a class move removes it"
tpost /api/admin/students/setclass '{"username":"demo","class":"cp3"}' >/dev/null

echo "== assignments: due dates and the paste setting =="
has "$(tpost /api/admin/assignments/settings '{"id":"hello-py","due":"2020-01-02 09:00","no_paste":true}')" \
    '"ok":true' "teacher sets a due date and blocks pasting"
al=$(curl -s -b $J $BASE/api/assignments)
has "$al" '"no_paste":true' "the student's assignment list carries the paste rule"
has "$al" '"due":' "the student's assignment list carries the due date"
has "$(tpost /api/admin/assignments/settings '{"id":"hello-py","due":"not a date"}')" \
    'look like' "an unreadable due date is refused"
# A due date that has passed marks the submission late; it is still graded.
# (Re-publishing after the class-move check restored the unfinished starter.)
curl -s -b $J -X POST --data-binary "def greet(name):
    return 'Hello, ' + name + '!'
" "$BASE/api/fs/write?path=/hello-py/main.py" >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
has "$res" '"late":true' "a submission after the due date is marked late"
has "$res" '"passed":3' "and is still graded"
has "$(curl -s -b $JT $BASE/api/admin/submissions)" '"late":true' "the teacher sees which submissions were late"
tpost /api/admin/assignments/settings '{"id":"hello-py","due":"","no_paste":false}' >/dev/null
res=$(curl -s -b $J -X POST -H 'Content-Type: application/json' -d '{"assignment":"hello-py"}' $BASE/api/submit)
has "$res" '"late":false' "with the due date cleared, nothing is late"

echo "== debug relay: the program waits, the editor answers =="
# The pause request blocks until a command arrives, which is what lets a
# breakpoint hold the program still.
( sleep 1; curl -s -b $J -X POST -H 'Content-Type: application/json' \
    -d '{"cmd":"next"}' "$BASE/api/run/debug/command?run=dbgtest" >/dev/null ) &
paused=$(curl -s -b $J -X POST -H 'Content-Type: application/json' \
    -d '{"t":"stopped","reason":"breakpoint"}' "$BASE/api/run/debug/pause?run=dbgtest")
has "$paused" '"cmd":"next"' "a paused program is released by the editor's command"
( sleep 1; curl -s -b $J -X POST -H 'Content-Type: application/json' \
    -d '{"t":"stopped","reason":"step"}' "$BASE/api/run/debug/pause?run=dbg2" >/dev/null ) &
has "$(curl -s -b $J "$BASE/api/run/debug/events?run=dbg2")" '"reason":"step"' "the editor is told where the program stopped"
# Let that program go, so nothing is left waiting on a command that never comes.
curl -s -b $J -X POST -H 'Content-Type: application/json' \
    -d '{"cmd":"stop"}' "$BASE/api/run/debug/command?run=dbg2" >/dev/null
chk "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/run/debug/events?run=dbg2")" "401" "the debug relay needs a session"

echo "== teacher: worker load report =="
wl=$(curl -s -b $JT $BASE/api/admin/workers)
has "$wl" '"load"' "workers carry a load report"
has "$wl" '"max_runs"' "load report says how many runs a node accepts"
has "$wl" '"loadavg"' "load report carries the machine's own load"

echo "== teacher: assignment template, then Submit as a rehearsal =="
tpost /api/admin/assignments/delete '{"id":"tmplpy"}' >/dev/null 2>&1
curl -s -b $JT -X POST "$BASE/api/fs/delete?path=/tmplpy" >/dev/null 2>&1
has "$(tpost /api/admin/assignments/template '{"folder":"tmplpy","language":"python","title":"Template"}')" '"ok":true' "template creates an assignment folder"
tl=$(curl -s -b $JT "$BASE/api/fs/list?path=/tmplpy")
has "$tl" 'starter' "template has a starter/ students receive"
has "$tl" 'tests' "template has private tests/"
has "$tl" 'solution' "template has a worked answer to check the tests"
has "$tl" 'assignment.yaml' "template writes its settings as yaml"
has "$(curl -s -b $JT "$BASE/api/fs/read?path=/tmplpy/assignment.yaml")" 'no_paste' "the settings file carries the paste setting"
# Submit before the assignment is published: the teacher's own folder describes
# it, and the unfinished starter must not pass everything.
res=$(tpost /api/submit '{"assignment":"tmplpy"}')
has "$res" '"dry_run":true' "a teacher's Submit is a rehearsal, not a grade"
has "$res" '"tests"' "the unpublished template grades through the real path"
echo "$res" | grep -q '"failed":0' && bad "the unfinished starter passed everything" || ok "the unfinished starter fails, as a student's would"
has "$res" 'io.prints_total' "the template carries an input/output case"
# The worked answer is graded in place: nothing to copy over the starter.
res=$(tpost /api/submit '{"assignment":"tmplpy","part":"solution"}')
has "$res" '"graded":"solution"' "a teacher can grade the solution instead of the starter"
has "$res" '"failed":0' "the template's worked answer passes its own tests"
subs=$(curl -s -b $JT $BASE/api/admin/submissions)
echo "$subs" | grep -q 'tmplpy' && bad "a teacher's rehearsal was recorded as a submission" || ok "a rehearsal leaves no submission behind"

echo "== teacher shell: who may open one =="
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1"}' $BASE/api/admin/shell/start)" "401" "shell refused when not logged in"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $J -X POST -H 'Content-Type: application/json' \
  -d '{"host":"127.0.0.1"}' $BASE/api/admin/shell/start)" "403" "shell refused to a student"
chk "$(curl -s -o /dev/null -w '%{http_code}' -b $JT -X POST -H 'Content-Type: application/json' \
  -d '{"host":"203.0.113.7"}' $BASE/api/admin/shell/start)" "404" "shell refused for a host that is not a worker"

echo
echo "==== $pass passed, $fail failed ===="
[ $fail -eq 0 ]
