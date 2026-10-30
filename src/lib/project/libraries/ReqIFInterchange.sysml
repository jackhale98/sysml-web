library package ReqIFInterchange {
    doc
    /*
     * Where requirements imported from a ReqIF file came from. ReqIF (OMG
     * Requirements Interchange Format) is how DOORS, DOORS Next, Polarion,
     * Jama, Codebeamer and other requirements tools exchange requirements.
     * Each object in a ReqIF file has an IDENTIFIER that stays the same
     * from one export to the next; Tessera keeps it on what it imports:
     *
     *   requirement <'SRS-12'> 'Attitude loop rate' {
     *       ...
     *       @ReqIF { identifier = "ID_DRN-12"; }
     *   }
     *
     * so that importing a later export of the same file updates these
     * requirements instead of adding them again, and exporting them as
     * ReqIF gives them back the identifiers the other tool knows. Packages
     * made from a specification or a heading carry theirs the same way.
     */

    private import ScalarValues::String;

    metadata def ReqIF {
        doc /* The IDENTIFIER of the ReqIF object, specification or heading this element came from. */

        attribute identifier : String {
            doc /* As the file wrote it; unique within that file. */
        }
    }
}
