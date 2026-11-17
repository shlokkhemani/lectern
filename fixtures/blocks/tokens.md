---
title: tokens fixture
lang: go
---

# Tracing add(1, 2 * 3, 4 + 5)
##
::: tokens tk markers=cur,peek
add ( 1 , 2 * 3 , 4 + 5 ) ;
IDENT LPAREN INT COMMA INT ASTERISK INT COMMA INT PLUS INT RPAREN SEMICOLON
:::
::: code args @left src=../../examples/part8/src/parser/parser.go:371-381 "parser/parser.go"
::: stack frame
CallExpression 0xc210 #ceb
  Token: (
  Function: nil #cfn
  Arguments: nil #cargs
parseCallArguments #pcaf
  args: [] #largs
:::
::: text tck
—
:::
[move tk 1] Now the full trace. [set tck leftExp = `add`] `leftExp` becomes add.

[move tk 2] It steps onto the bracket. [show ceb; set cfn `add`] Add becomes the function.

[show pcaf; hl args:371; move tk 3] It steps onto 1. [group tk:3 arg 0 #a0; set largs `[1]`] The argument ends.

[hl args:374-375; move tk 5] Hops twice, onto 2, [move tk 7; set tck two hops → `2` · `*` takes it · stops at `,`] the times takes 2 and 3. [group tk:5-7 arg 1 #a1; set largs `[1, 2*3]`] Then the next comma stops it.

[hl args:373; move tk 9] Another comma, [move tk 11] 4 plus 5. [group tk:9-11 arg 2 #a2; set largs `[1, 2*3, 4+5]`] The closing bracket stops it.

[move tk 12; hl args:378] It steps onto the bracket. [hide pcaf; set cargs `[1, 2*3, 4+5]`] The three arguments become the list.
