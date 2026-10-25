// Must fail: unresolved name. The cross-file import of MustFailOther must resolve.
package MustFailLinking {
    private import MustFailOther::*;
    part p : NoSuchDefinition;
    part q : Defined;
}
