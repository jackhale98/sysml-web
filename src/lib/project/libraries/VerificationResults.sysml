library package VerificationResults {
    doc
    /*
     * Recorded outcomes of verification cases: what a verification case
     * returned when it was run, when, by whom, against which commit of the
     * model, and where the evidence is. Tessera records one on a
     * verification case (Record a result, in its details); any tool can
     * read or write it, as it is plain SysML metadata:
     *
     *   verification <'VC-001'> enduranceFlightTest {
     *       ...
     *       @VerificationResult {
     *           verdict = VerdictKind::pass;
     *           date = "2026-10-20";
     *           runBy = "A. Engineer";
     *           commit = "3f2a9c1d0b...";
     *           evidence = "https://example.com/flight-log-17.csv";
     *       }
     *   }
     *
     * The verdict is SysML's own VerdictKind (VerificationCases): pass,
     * fail, inconclusive or error. A result names the commit of the model it
     * was run against: once the model changes, it may no longer hold, and
     * Tessera shows it as out of date. A case keeps its latest result; the
     * earlier ones are in the history of the files.
     */

    private import ScalarValues::String;
    private import VerificationCases::VerdictKind;

    metadata def VerificationResult {
        doc /* The outcome of one run of the verification case it annotates. */
        :> annotatedElement : SysML::VerificationCaseUsage;

        attribute verdict : VerdictKind {
            doc /* pass, fail, inconclusive or error. */
        }
        attribute date : String {
            doc /* When it was run, as an ISO 8601 date (2026-10-20). */
        }
        attribute runBy : String[0..1] {
            doc /* Who ran it. */
        }
        attribute commit : String[0..1] {
            doc /* The commit of the model it was run against (a Git commit SHA). */
        }
        attribute evidence : String[0..1] {
            doc /* Where the evidence is: a test report, a log, a link. */
        }
    }
}
