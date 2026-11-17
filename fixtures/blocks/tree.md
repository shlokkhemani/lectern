---
title: tree fixture
lang: go
---

# The node
##
::: code ast @left "ast/ast.go · book code"
type CallExpression struct {
  Token     token.Token
  Function  Expression
  Arguments []Expression
}
... String() prints add(1, (2 * 3), (4 + 5))
:::
::: tree ctree "the tree for add(1, 2 * 3, 4 + 5)"
{em CallExpression} #ce
  Function | add #fn
  Arg 0 | 1
  Arg 1 | *
    2
    3
  Arg 2 | +
    4
    5
:::
::: callout fnote
Function is an {em Expression}, not just a name, so a function literal fits there too. Its Token is the `{em (}`, the token that marks the call.
:::
[hl ast:1-5] The node has the function, and a list of arguments. Here is [grow ctree; hl ce] the tree for the book's test.

[hl ast:2-3; show fnote; hl fn] Function is any expression, not just a name.

##
::: tokens twhy
a + add ( b * c )
IDENT PLUS IDENT LPAREN IDENT ASTERISK IDENT RPAREN
:::
::: tree good @left "CALL highest"
+
  a
  call #gcall
    add
    b * c
:::
::: tree bad "CALL below SUM"
call #bcall
  +
    a
    add
  b * c
:::
::: callout wrong
It calls the sum `a + add`.
:::
Why the highest? [grow good] The call should belong to add. With `CALL` highest, [hl twhy:3-4; hl gcall] the bracket grabs add before the plus can.

[grow bad] If `CALL` were lower than plus, [hl twhy:1-3] the plus would grab add first, and [hl bcall] the bracket would call the sum. [show wrong] Nonsense.
