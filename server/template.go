package main

// Assignment templates.
//
// Writing an assignment from nothing means knowing the folder layout, the test
// naming the graders look for, and which JUnit imports are on the classpath.
// A template answers all three at once: it drops a small assignment that
// already passes into the teacher's own files, so the first thing they do is
// run it, see green, and edit from there rather than debug a blank folder.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type templateFile struct {
	rel  string
	body string
}

// The Python template. Tests are pytest-style (test_*.py, test_* functions,
// plain assert), which is what the in-sandbox harness runs.
var pythonTemplate = []templateFile{
	{"starter/main.py", `# Students see this file. Leave the function bodies unfinished.


def total_price(prices, tax_rate):
    """Return the sum of prices with tax_rate applied (0.07 means 7 percent)."""
    return 0.0


if __name__ == '__main__':
    print(total_price([10.0, 5.0], 0.07))
`},
	{"solution/main.py", `# Not published to students: your own worked answer. Copy it over
# starter/main.py to check the tests really pass, then copy the starter back.


def total_price(prices, tax_rate):
    """Return the sum of prices with tax_rate applied (0.07 means 7 percent)."""
    return round(sum(prices) * (1 + tax_rate), 2)


if __name__ == '__main__':
    print(total_price([10.0, 5.0], 0.07))
`},
	{"tests/test_main.py", `# Private tests. Students never see this file, and it is deleted from the
# sandbox before their code runs, so it can hold the expected answers.
#
# The rules: the file is named test_*.py, every test is a function named
# test_*, and checks are plain assert. Import the student's module by name.

import main


def test_adds_tax():
    assert main.total_price([10.0, 5.0], 0.07) == 16.05


def test_no_items_is_zero():
    assert main.total_price([], 0.07) == 0


def test_zero_tax_is_the_plain_sum():
    assert main.total_price([2.5, 2.5], 0.0) == 5.0
`},
}

// The Java template. The grader compiles every .java it finds and runs each
// class whose name contains "Test", so the test class name matters.
var javaTemplate = []templateFile{
	{"starter/Cart.java", `// Students see this file. Leave the method bodies unfinished.
public class Cart {
    /** Sum the prices with taxRate applied (0.07 means 7 percent). */
    public static double totalPrice(double[] prices, double taxRate) {
        return 0.0;
    }

    public static void main(String[] args) {
        System.out.println(totalPrice(new double[] { 10.0, 5.0 }, 0.07));
    }
}
`},
	{"solution/Cart.java", `// Not published to students: your own worked answer. Copy it over
// starter/Cart.java to check the tests really pass, then copy the starter back.
public class Cart {
    /** Sum the prices with taxRate applied (0.07 means 7 percent). */
    public static double totalPrice(double[] prices, double taxRate) {
        double sum = 0.0;
        for (double p : prices) {
            sum += p;
        }
        return Math.round(sum * (1 + taxRate) * 100.0) / 100.0;
    }

    public static void main(String[] args) {
        System.out.println(totalPrice(new double[] { 10.0, 5.0 }, 0.07));
    }
}
`},
	{"tests/CartTest.java", `// Private tests. Students never see this file: the grader deletes all .java
// source after compiling and before running, so it can hold expected answers.
//
// The rules: the class name contains "Test", it uses JUnit 4 (org.junit.Test
// plus static Assert imports), and it is in the default package like the
// starter. Compare doubles with a delta.

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class CartTest {
    @Test public void addsTax() {
        assertEquals(16.05, Cart.totalPrice(new double[] { 10.0, 5.0 }, 0.07), 0.001);
    }

    @Test public void noItemsIsZero() {
        assertEquals(0.0, Cart.totalPrice(new double[] {}, 0.07), 0.001);
    }

    @Test public void zeroTaxIsThePlainSum() {
        assertEquals(5.0, Cart.totalPrice(new double[] { 2.5, 2.5 }, 0.0), 0.001);
    }
}
`},
}

const templateReadme = `# %s

A working assignment you can edit. It already passes, so run it first and see
green before you change anything.

## What is in here

- starter/  what each student receives when you publish. This is the only
  folder they see.
- tests/    the private tests the grader runs. Students never receive these,
  and the grader deletes the test source inside the sandbox before student
  code runs, so expected answers are safe here.
- solution/ your own worked answer. It is not published and not graded; it is
  here so you can check the tests really pass.
- assignment.yaml  the settings: title, how long a run may take, when it is
  due, and whether students may paste into it. Edit it before you publish, or
  change the due date and the paste setting later from Class Management.

## Try it

1. Press Submit with a file from this folder open. Submit runs the starter
   against the tests on a worker, exactly the way a student's submission runs.
   The starter is unfinished, so the tests fail: that is the expected result.
2. Copy solution/%s over starter/%s and press Submit again. Everything passes.
3. Copy the starter back, then write your own task.

## Publish it

Class Management -> Assignments -> Create from folder, and give this folder.
`

func templateFiles(lang string) ([]templateFile, string) {
	if lang == "java" {
		return javaTemplate, "Cart.java"
	}
	return pythonTemplate, "main.py"
}

// authoringManifest describes an assignment the teacher has written but not yet
// created, so it can be graded before it exists. It reads the assignment.yaml a
// template leaves behind, and falls back to what the tests are written in.
func authoringManifest(folder string) *Manifest {
	if !isDir(filepath.Join(folder, "starter")) || !isDir(filepath.Join(folder, "tests")) {
		return nil
	}
	m := &Manifest{Language: "", Title: filepath.Base(folder), TimeoutSec: 15}
	if meta := readAssignmentMeta(folder); meta != nil {
		m.Language, m.TimeoutSec, m.MemMB = meta.Language, meta.TimeoutSec, meta.MemMB
		m.NoPaste = meta.NoPaste
		if due, ok := parseDue(meta.Due); ok {
			m.Due = due
		}
		if meta.Title != "" {
			m.Title = meta.Title
		}
	}
	if m.Language == "" {
		m.Language = guessLanguage(filepath.Join(folder, "tests"))
	}
	if m.TimeoutSec <= 0 {
		m.TimeoutSec = 15
	}
	return m
}

func guessLanguage(dir string) string {
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".java") {
			return "java"
		}
	}
	return "python"
}

func handleAdminAssignmentTemplate(w http.ResponseWriter, r *http.Request) {
	u := requireTeacher(w, r)
	if u == nil {
		return
	}
	var body struct{ Folder, Language, Title string }
	if err := readBody(r, &body); err != nil {
		fail(w, 400, "bad json")
		return
	}
	folder := strings.Trim(body.Folder, "/ ")
	if !validID(folder) {
		fail(w, 400, "folder name must be letters, numbers, - or _")
		return
	}
	lang := body.Language
	if lang != "java" {
		lang = "python"
	}
	base, err := safePath(studentRoot(u), folder)
	if err != nil {
		fail(w, 400, "bad path")
		return
	}
	if _, err := os.Stat(base); err == nil {
		fail(w, 409, "\""+folder+"\" already exists in your files")
		return
	}

	files, entry := templateFiles(lang)
	for _, f := range files {
		p := filepath.Join(base, filepath.FromSlash(f.rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			fail(w, 500, "could not create the folder")
			return
		}
		if err := os.WriteFile(p, []byte(f.body), 0o644); err != nil {
			fail(w, 500, "could not write "+f.rel)
			return
		}
	}

	title := strings.TrimSpace(body.Title)
	if title == "" {
		title = folder
	}
	readme := fmt.Sprintf(templateReadme, title, entry, entry)
	_ = os.WriteFile(filepath.Join(base, "README.md"), []byte(readme), 0o644)

	// The description file the teacher edits. Creating from a folder reads the
	// settings back out of it, and zipping the folder carries them along.
	meta := fmt.Sprintf(`# What this assignment is, and how it is run.
id: %s
title: %s
language: %s

# How long one grading run may take, in seconds.
timeout_sec: 15

# When it is due: "2026-09-14 23:59", or a plain date for the end of that day.
# Leave it empty for no due date. A late submission is still graded and still
# reaches you; it is marked late. Use Unpublish to actually close an assignment.
due:

# Set to true to stop students pasting code they did not write in this editor.
no_paste: false
`, folder, title, lang)
	_ = os.WriteFile(filepath.Join(base, "assignment.yaml"), []byte(meta), 0o644)

	writeJSON(w, 200, map[string]any{
		"ok": true, "folder": folder, "language": lang, "entry": entry})
}
