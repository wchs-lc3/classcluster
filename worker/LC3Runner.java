import org.junit.runner.JUnitCore;
import org.junit.runner.Result;
import org.junit.runner.notification.Failure;
import org.junit.runner.notification.RunListener;
import org.junit.runner.Description;

import java.io.PrintStream;
import java.io.OutputStream;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Runs the given JUnit 4 test classes and prints one machine-readable line
 * per test to the real stdout: "LC3TEST PASS|FAIL className.methodName".
 * Student System.out output is swallowed so it cannot forge result lines.
 */
public class LC3Runner {
    public static void main(String[] args) throws Exception {
        final PrintStream real = System.out;
        PrintStream sink = new PrintStream(new OutputStream() {
            public void write(int b) {}
        });
        System.setOut(sink);
        System.setErr(sink);

        JUnitCore core = new JUnitCore();
        final Set<String> failed = new LinkedHashSet<>();
        final Set<String> all = new LinkedHashSet<>();
        core.addListener(new RunListener() {
            public void testStarted(Description d) {
                all.add(d.getClassName() + "." + d.getMethodName());
            }
            public void testFailure(Failure f) {
                Description d = f.getDescription();
                failed.add(d.getClassName() + "." + d.getMethodName());
            }
        });

        for (String cls : args) {
            try {
                core.run(Class.forName(cls));
            } catch (Throwable t) {
                real.println("LC3TEST FAIL " + cls + ".<load>");
            }
        }
        for (String name : all) {
            real.println("LC3TEST " + (failed.contains(name) ? "FAIL" : "PASS") + " " + name);
        }
        real.flush();
        System.exit(0);
    }
}
