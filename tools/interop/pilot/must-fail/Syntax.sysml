// Must fail: syntax error (attribute with no type after the colon).
package MustFailSyntax {
    part def A {
        attribute x : ;
    }
}
