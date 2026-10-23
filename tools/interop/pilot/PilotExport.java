// Export a model's abstract syntax as SysML v2 JSON with the OMG pilot implementation
// (its Jupyter kernel's %export): load the library, process each file in the given order,
// then export each named top-level element. Usage:
//   java -cp <kernel jar> PilotExport.java <sysml.library dir> <out.json> <file>... -- <name>...
import java.io.PrintStream;
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import org.omg.sysml.interactive.SysMLInteractive;
import org.omg.sysml.interactive.SysMLInteractiveResult;

public class PilotExport {
    public static void main(String[] args) throws Exception {
        PrintStream out = System.out;
        System.setOut(new PrintStream(PrintStream.nullOutputStream()));
        SysMLInteractive pilot = SysMLInteractive.createInstance();
        pilot.setVerbose(false);
        pilot.loadLibrary(Path.of(args[0]).toAbsolutePath().normalize().toString());
        int i = 2;
        for (; i < args.length && !args[i].equals("--"); i++) {
            SysMLInteractiveResult r = pilot.process(Files.readString(Path.of(args[i])));
            out.println(args[i] + ": " + r.toString().replaceAll("\\s+", " ").substring(0, Math.min(300, r.toString().replaceAll("\\s+", " ").length())));
        }
        JsonArray all = new JsonArray();
        for (i++; i < args.length; i++) {
            Object result = pilot.export(args[i], List.of());
            if (result instanceof JsonArray a) { all.addAll(a); out.println(args[i] + ": " + a.size() + " elements"); }
            else out.println(args[i] + ": " + result);
        }
        Files.writeString(Path.of(args[1]), new GsonBuilder().setPrettyPrinting().create().toJson(all));
        System.exit(0);
    }
}
