// Must fail: well-formedness rules (a part typed by an attribute definition,
// an attribute typed by a part definition).
package MustFailRules {
    attribute def Num;
    part def P;
    part bad : Num;
    attribute alsoBad : P;
}
