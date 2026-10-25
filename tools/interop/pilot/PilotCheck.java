// Headless parse + validation check against the OMG SysML v2 pilot implementation.
//
// Run with the pilot's self-contained jar on the classpath (Java 21 runs this
// source file directly, no compile step):
//
//   java -cp jupyter-sysml-kernel-<ver>-all.jar PilotCheck.java \
//        [--json out.json] [--quiet] [--each-dir] <sysml.library dir> <file-or-dir>...
//
// --each-dir treats every immediate subdirectory of each directory argument as
// a separate model (e.g. the release corpus, where each example folder stands
// alone): its files are checked together, then unloaded and dropped from the
// index before the next folder, so folders cannot see each other.
//
// Loads the standard library the same way the pilot's Jupyter kernel does
// (SysMLInteractive.loadLibrary), loads every given .sysml/.kerml file into the
// same resource set (so files can reference each other), resolves all
// references, then runs the pilot's Xtext validator (syntax, linking and the
// SysML/KerML validation rules) on each input file. Prints every issue per file
// and a summary. Exit status: 0 = no errors, 1 = at least one error, 2 = usage.

import java.io.File;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Stream;

import org.eclipse.emf.ecore.resource.Resource;
import org.eclipse.xtext.diagnostics.Severity;
import org.eclipse.xtext.resource.XtextResource;
import org.eclipse.xtext.resource.impl.ResourceDescriptionsData;
import org.eclipse.xtext.util.CancelIndicator;
import org.eclipse.xtext.validation.CheckMode;
import org.eclipse.xtext.validation.IResourceValidator;
import org.eclipse.xtext.validation.Issue;
import org.omg.sysml.interactive.SysMLInteractive;

public class PilotCheck {

    public static void main(String[] args) throws Exception {
        String jsonOut = null;
        boolean quiet = false, eachDir = false;
        List<String> rest = new ArrayList<>();
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--json") && i + 1 < args.length) jsonOut = args[++i];
            else if (args[i].equals("--quiet")) quiet = true;
            else if (args[i].equals("--each-dir")) eachDir = true;
            else rest.add(args[i]);
        }
        if (rest.size() < 2) {
            System.err.println("usage: PilotCheck [--json out.json] [--quiet] [--each-dir] <sysml.library dir> <file-or-dir>...");
            System.exit(2);
        }

        // The pilot prints progress on stdout while reading; keep our report clean.
        PrintStream out = System.out;
        System.setOut(new PrintStream(PrintStream.nullOutputStream()));

        SysMLInteractive pilot = SysMLInteractive.createInstance();
        pilot.setVerbose(false);
        long t0 = System.currentTimeMillis();
        // Absolute path: the pilot builds URIs from it and mis-decodes relative ones with spaces.
        pilot.loadLibrary(Path.of(rest.get(0)).toAbsolutePath().normalize().toString());
        long tLib = System.currentTimeMillis() - t0;

        // Group the input files: one group of everything, or one per folder.
        Map<String, List<Path>> groups = new LinkedHashMap<>();
        for (String arg : rest.subList(1, rest.size())) {
            Path root = Path.of(arg);
            if (eachDir && Files.isDirectory(root)) {
                try (Stream<Path> s = Files.list(root)) {
                    for (Path child : s.sorted().toList()) {
                        List<Path> fs = sysmlFiles(child);
                        if (!fs.isEmpty()) groups.put(child.toString(), fs);
                    }
                }
            } else {
                groups.computeIfAbsent("", k -> new ArrayList<>()).addAll(sysmlFiles(root));
            }
        }
        System.setOut(out);

        int totalErr = 0, totalWarn = 0, filesWithErr = 0, fileCount = 0, groupsWithErr = 0;
        StringBuilder json = new StringBuilder("{\"files\":[");
        boolean firstFile = true;
        for (Map.Entry<String, List<Path>> g : groups.entrySet()) {
            System.setOut(new PrintStream(PrintStream.nullOutputStream()));
            Map<String, Resource> byFile = new TreeMap<>();
            for (Path p : g.getValue()) {
                Resource r = pilot.readResource(p.toAbsolutePath().normalize().toString());
                pilot.addInputResource(r);
                byFile.put(p.toString(), r);
            }
            pilot.resolveAllInputResources();
            System.setOut(out);

            int groupErr = 0, groupWarn = 0;
            StringBuilder text = new StringBuilder();
            for (Map.Entry<String, Resource> e : byFile.entrySet()) {
                Resource r = e.getValue();
                List<Issue> issues = r instanceof XtextResource xr
                        ? xr.getResourceServiceProvider().getResourceValidator()
                            .validate(r, CheckMode.ALL, CancelIndicator.NullImpl)
                        : List.of();
                int err = 0, warn = 0;
                for (Issue i : issues) {
                    if (i.getSeverity() == Severity.ERROR) err++;
                    else if (i.getSeverity() == Severity.WARNING) warn++;
                }
                groupErr += err; groupWarn += warn; fileCount++;
                if (err > 0) filesWithErr++;
                if (!quiet || err > 0 || warn > 0) {
                    text.append(String.format("%s: %d error(s), %d warning(s)%n", e.getKey(), err, warn));
                    for (Issue i : issues) {
                        if (i.getSeverity() == Severity.INFO || i.getSeverity() == Severity.IGNORE) continue;
                        text.append(String.format("  %s %s:%s %s%s%n", i.getSeverity(), i.getLineNumber(),
                                i.getColumn(), i.getMessage(), i.getCode() == null ? "" : "  [" + i.getCode() + "]"));
                    }
                }
                if (!firstFile) json.append(',');
                firstFile = false;
                json.append("{\"group\":").append(q(g.getKey()))
                    .append(",\"file\":").append(q(e.getKey())).append(",\"issues\":[");
                boolean firstIssue = true;
                for (Issue i : issues) {
                    if (!firstIssue) json.append(',');
                    firstIssue = false;
                    json.append("{\"severity\":").append(q(String.valueOf(i.getSeverity())))
                        .append(",\"line\":").append(i.getLineNumber())
                        .append(",\"column\":").append(i.getColumn())
                        .append(",\"code\":").append(q(i.getCode()))
                        .append(",\"message\":").append(q(i.getMessage())).append('}');
                }
                json.append("]}");
            }
            totalErr += groupErr; totalWarn += groupWarn;
            if (groupErr > 0) groupsWithErr++;
            if (eachDir) {
                out.printf("== %s: %d file(s), %d error(s), %d warning(s)%n", g.getKey(), byFile.size(), groupErr, groupWarn);
            }
            out.print(text);

            // Forget this group before the next one.
            ResourceDescriptionsData index = ResourceDescriptionsData.ResourceSetAdapter
                    .findResourceDescriptionsData(pilot.getResourceSet());
            for (Resource r : byFile.values()) {
                pilot.getInputResources().remove(r);
                if (index != null) index.removeDescription(r.getURI());
                r.unload();
                pilot.getResourceSet().getResources().remove(r);
            }
        }
        json.append("],\"summary\":{\"groups\":").append(groups.size())
            .append(",\"groupsWithErrors\":").append(groupsWithErr)
            .append(",\"files\":").append(fileCount)
            .append(",\"filesWithErrors\":").append(filesWithErr)
            .append(",\"errors\":").append(totalErr)
            .append(",\"warnings\":").append(totalWarn).append("}}\n");
        if (jsonOut != null) Files.writeString(Path.of(jsonOut), json);

        out.printf("%nPilot check: %s%d file(s), %d with errors; %d error(s), %d warning(s) (library loaded in %d ms)%n",
                eachDir ? groups.size() + " folder(s), " + groupsWithErr + " with errors; " : "",
                fileCount, filesWithErr, totalErr, totalWarn, tLib);
        System.exit(totalErr > 0 ? 1 : 0);
    }

    private static List<Path> sysmlFiles(Path root) throws java.io.IOException {
        try (Stream<Path> s = Files.walk(root)) {
            return s.filter(p -> Files.isRegularFile(p)
                    && (p.toString().endsWith(".sysml") || p.toString().endsWith(".kerml")))
                .sorted().toList();
        }
    }

    private static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> { if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c); }
            }
        }
        return b.append('"').toString();
    }
}
