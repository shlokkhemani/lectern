---
title: Call expressions, and a finished parser
series: Your parser, part 8
lang: go
---

##
::: title
Call expressions, and a finished parser
Your parser, part 8 · book pages 93 to 99
- the bracket that sits in the middle
- `CALL`, the tightest precedence
- let and return, finally complete
:::
The last piece of the parser: calling a function. It comes with a neat puzzle, and once it is solved, we tidy up the let and return statements, and the parser is done.

# What a call looks like
## The shape of a call
::: text
`{em <expression>}({alt <expressions, comma-separated>})`
:::
::: table ex
| `add(2, 3)` | the call you know |
| `add({alt 2 + 2}, {alt 3 * 3 * 3})` | arguments can be {alt any expression} |
| `{em fn(x, y) { x + y; }}(2, 3)` | the function can be {em any expression} too |
| `callsFunction(2, 3, {alt fn(x, y) { x + y; }})` | and a function can be an argument |
:::
[show hl ex:1] The shape is: an expression, then a list of expressions in brackets, separated by commas. Start with the call you know: add of 2 and 3.

[show hl ex:2] The arguments do not have to be plain numbers. Each one can be any expression: 2 plus 2, or 3 times 3 times 3.

[show hl ex:3] The thing being called does not have to be a name either. It can be any expression that gives a function, like a function literal, called on the spot.

[show hl ex:4] And because functions are values, you can pass one in as an argument.

## Parameters vs arguments
::: compare pa
defining · last video #def
`fn({box a}, {box b}) { a + b }`
{em Parameters}: names the function is waiting for. Only names allowed.
`[]*ast.Identifier`
---
calling · this video #call
`add({box 1}, {box 2 * 3})`
{alt Arguments}: the values you hand over. Any expression allowed.
`[]ast.Expression`
:::
::: text runs
When the call runs, `{em a}` will hold `{alt 1}` and `{em b}` will hold `{alt 6}`. That happens in the evaluator, later in the book.
:::
[show hl def] Quick vocabulary. When you define a function, the names in brackets are parameters. They are only names, waiting for values.

[show hl call] When you call a function, the things in brackets are arguments. They are the values you hand over, and each can be any expression.

[show hl runs] When the call actually runs, a gets 1 and b gets 6. But that is the evaluator's job, later in the book. The parser only records the shape.

# The node
##
::: code ast @top "ast/ast.go · book code"
type CallExpression struct {
  Token     token.Token // the '(' token
  Function  Expression  // Identifier or FunctionLiteral
  Arguments []Expression
}
... expressionNode, TokenLiteral and String, like every node
:::
::: tree ctree @left "the tree for add(1, 2 * 3, 4 + 5)"
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
[hl ast:1-5] The node has the function, and a list of arguments. Here is [grow ctree; hl ce] the tree for the book's test: add, called with 1, 2 times 3, and 4 plus 5.

[hl ast:2-3; show fnote; hl fn] Function is any expression, not just a name, so a function literal fits there too. And the token stored in the node is the open bracket. That is a clue for what comes next.

# The puzzle
##
::: terminal err "go test · TestCallExpressionParsing"
expected next token to be ), got , instead
no prefix parse function for , found
no prefix parse function for , found
no prefix parse function for ) found
:::
::: callout pzn
Every feature so far failed with "no prefix parse function for {em X}". A call has {em no new token}.
:::
::: text q
So which token triggers the call, and in which map?
:::
[show err] Here is the puzzle. With the node defined, the test fails like this. [hl err:1] Expected next token to be close paren, got comma instead.

[show hl pzn] Every feature so far failed with: no prefix parse function for some new token. Not this time. A call has no new token at all. It is just an expression, brackets and commas.

[show hl q] So which token should trigger the call, and in which map?

## One token, two jobs, decided by position
::: compare two
`(` at the {em start} #pre
`{box (}5 + 5) * 2`
nothing on its left: {em prefix}, a group
---
`(` {alt after} an expression #in
`add{box (}2, 3)`
an expression on its left: {alt infix}, a call
:::
::: text tw
Same trick as minus: one token, registered in {em both} maps.
:::
[show hl pre] Look at where the open bracket sits. In 5 plus 5 in brackets, times 2, it starts the expression. Nothing on its left. That is prefix position, and it means grouping.

[show hl in] In add of 2 and 3, the bracket comes right after an expression, add. Something on its left. That is infix position, exactly where a plus sign would sit.

[show hl tw] So the open bracket goes into both maps, just like minus did. As a prefix it groups. As an infix it calls, and the expression on its left is the function.

# parseCallExpression
##
::: code reg src=part8/src/parser/parser.go:71-71
::: code pce src=part8/src/parser/parser.go:359-363
[hl reg:71] So the bracket is registered as an infix, with `parseCallExpression`. [hl pce:359] Like every infix function, it receives the expression on its left. For a plus, that was the left operand. [hl pce:360] Here it is the function being called.

##
::: code pca @left src=part8/src/parser/parser.go:365-381
::: table cmp
| parameters | arguments |
|---|---|
| `)`? empty | `)`? empty |
| {alt a name} | {em an expression} |
| `,`? hop, hop | `,`? hop, hop |
| {alt a name} | {em an expression} |
| expect `)` | expect `)` |
:::
::: callout pcn
Same shape. Each item is a {em full expression}, not a name.
:::
[show cmp] Then `parseCallArguments` reads the list. Compare it with `parseFunctionParameters` from last video. Same shape: [hl pca:367-370; hl cmp:1] check for an empty list, [hl pca:371-372; hl cmp:2] read one item, and [hl pca:373-377; hl cmp:3-4] while a comma follows, hop twice and read another.

[show pcn; hl cmp:2,4; hl pca:372,376] The only difference: each argument is a full expression, parsed by `parseExpression` at `LOWEST`, instead of a single name.

# Still failing: precedence
##
::: tokens tnp markers=cur,peek
add ( 2 , 3 ) ;
IDENT LPAREN INT COMMA INT RPAREN SEMICOLON
:::
::: code pexpr @left src=part8/src/parser/parser.go:155-165
::: code prec @left src=part8/src/parser/parser.go:22-32
::: text ck
next: `(` is not in the table → `LOWEST 1`
:::
::: callout np1
The statement ends as just `add`. The `(` starts a {em new} one, as a group.
:::
::: callout np2
The group reads `(2`, wants `)`, finds `,`
:::
::: callout fix
`token.LPAREN: CALL`. `CALL` is 7, the highest.
:::
And yet, the test still fails with the same error. Why? [hl pexpr:156-157] Look at the loop in `parseExpression`. [move tnp 1] After parsing add, it checks the precedence of the next token, the bracket. [show hl ck] And the bracket is not in the precedence table, so it counts as `LOWEST`.

[set ck `LOWEST < LOWEST`? {bad no}] Is `LOWEST` less than `LOWEST`? No. [show hl np1] So the loop never hands add to the bracket. The statement ends as just add, and the bracket starts a brand new statement, as a group.

[show hl np2] That group parses 2, then expects a closing bracket, and finds a comma. That is the error we saw. The infix function was registered, but never reached.

[swap pexpr prec] The fix is one line in the precedences map: [hl prec:31; show hl fix] the open bracket gets `CALL`, which is 7, the highest level of all.

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
Why the highest? Take a plus add of b times c. [grow good] The call should belong to add, and its result gets added to a. With `CALL` highest, [hl twhy:3-4; hl gcall] the bracket grabs add before the plus can.

[grow bad] If `CALL` were lower than plus, [hl twhy:1-3] the plus would grab add first, and [hl bcall] the bracket would call the sum of a and add. [show hl wrong] Nonsense. A call must stick to the expression right before it, tighter than anything else.

# Tracing add(1, 2 * 3, 4 + 5)
##
::: tokens tk markers=cur,peek
add ( 1 , 2 * 3 , 4 + 5 ) ;
IDENT LPAREN INT COMMA INT ASTERISK INT COMMA INT PLUS INT RPAREN SEMICOLON
:::
::: pexpr @left
::: stack frame
CallExpression 0xc210 #ceb
  Token: (
  Function: nil #cfn
  Arguments: nil #cargs
:::
::: text tck
—
:::
[move tk 1] Now the full trace. `parseExpression` starts at `LOWEST`. The current token is add, an identifier, so [hl pexpr:155; set tck leftExp = `add`] `leftExp` becomes add.

[hl pexpr:156-157; set tck `(` is `CALL 7` · {ok 1 < 7, it takes add}] The loop checks the next token: the bracket, now `CALL`, 7. Is `LOWEST` less than 7? Yes. So it [hl pexpr:163,165; move tk 2] steps onto the bracket and calls `parseCallExpression`, handing it add. [show ceb; set cfn `add`] Add becomes the function.

##
::: tk
::: code args @left src=part8/src/parser/parser.go:371-381
::: pexpr @left
::: frame
::: stack calls
parseCallArguments #pcaf
  args: [] #largs
:::
::: tck
[show pcaf] `parseCallArguments`. The list is not empty, so it [hl args:371; move tk 3] steps onto 1 and [hl args:372] parses an expression at `LOWEST`. It gets 1, then sees a comma. [set tck a comma is `LOWEST`: {bad the argument ends}] A comma is not an operator, so it counts as `LOWEST`, and [group tk:3 arg 0 #a0; set largs `[1]`] the argument ends.

[hl args:373] A comma follows, so it [hl args:374-375; move tk 5] hops twice, onto 2, and [hl args:376] parses again. Inside an argument, operators work as usual: [move tk 7; set tck two hops, `*` takes 2 and 3] the times takes 2 and 3. [group tk:5-7 arg 1 #a1; set largs `[1 (2 * 3)]`] Then the next comma stops it.

[hl args:373-376; move tk 9] Another comma, another two hops, and [move tk 11; set tck two hops, `+` takes 4 and 5] 4 plus 5. [group tk:9-11 arg 2 #a2; set largs `[1 (2 * 3) (4 + 5)]`] This time the closing bracket stops it, because it is `LOWEST` too.

[hl args:378] No more commas. `expectPeek` checks for the closing bracket and [move tk 12; set tck `expectPeek` `)` {ok ✓}] steps onto it. [hl args:381; hide pcaf; set cargs `[1 (2 * 3) (4 + 5)]`] The three arguments become the arguments list. [set tck commas and `)` are `LOWEST`: walls] Notice: commas and the closing bracket act as walls, the same trick the grouped expression used.

[swap args pexpr; hl pexpr:156-157] Back in the outer loop, the next token is a semicolon, so it [hl ceb; set tck {ok `add(1, (2 * 3), (4 + 5))`}] stops and returns the call expression. Exactly the tree we drew at the start.

##
::: table more
| input | parses as |
|---|---|
| `add(a, b, 1, 2 * 3, 4 + 5, add(6, 7 * 8))` | `{ok add(a, b, 1, (2 * 3), (4 + 5), add(6, (7 * 8)))}` |
| `fn(x, y) { x + y; }(2, 3)` | `{ok fn(x, y) (x + y)(2, 3)}` |
| `-add(1)` | `{ok (-add(1))}`: `CALL` 7 beats `PREFIX` 6 |
:::
::: callout mn
No extra code: arguments and callee are just expressions.
:::
[show more:1-3] And because each argument is a full expression, all of these work for free. [hl more:1] A call inside a call. [hl more:2] A function literal called on the spot. [hl more:3] And minus applied to a call result: the call binds first, because 7 beats 6.

[show hl mn] None of them needed any extra code.

# Removing the TODOs
##
::: code let @left src=part8/src/parser/parser.go:119-127
::: callout before
Before: `let x = 5 * 2;` skips to `;`. Value `nil`, prints `let x = ;`
:::
::: callout after
After: Value `(5 * 2)`, prints `let x = (5 * 2);`
:::
::: text tdn
Same three lines in `parseReturnStatement`.
:::
::: text max
`let max` from the if video now prints
`{ok let max = if(a > b) aelse b;}`
:::
[show hl before] One last job. Remember the shortcut in let and return? They skipped every token until the semicolon, so their value was always nil.

[show hl after] Now the parser can parse any expression, so the shortcut goes. [hl let:122] Step onto the value, call [hl let:123] `parseExpression` at `LOWEST`, and [hl let:124-126] skip an optional semicolon. [hl let:122-126] Three small changes.

[show tdn] Return gets the same three lines. [show hl max] And the let max example from the if video finally keeps its value.

##
::: text src @top
`let add = fn(a, b) { a + b }; add(1, 2);`
:::
::: tree prog
{em Program}
  LetStatement
    Name | add
    Value | FunctionLiteral #pfl
      Params | a, b
      Body | a + b
  ExpressionStatement
    CallExpression #pcall
      Function | add
      Arg 0 | 1
      Arg 1 | 2
:::
So here is a real two-line program. [grow prog:1-4] Define add, [grow prog:7-8] then call it. [hl pfl] The let statement holds the function literal as its value.

[hl pcall; grow prog:9-11] And the call holds add and its two arguments. [grow prog:5-6] Every piece of this tree comes from something you built.

# The finished parser
## The finished Pratt table
::: table pratt
| token | prefix: starts an expression | infix: follows an expression |
|---|---|---|
| `IDENT` · `INT` | `parseIdentifier` · `parseIntegerLiteral` | — |
| `TRUE` · `FALSE` | `parseBoolean` | — |
| `!` | `parsePrefixExpression` | — |
| `-` | `parsePrefixExpression` | `parseInfixExpression` |
| `+ * / == != < >` | — | `parseInfixExpression` |
| `(` | `parseGroupedExpression` | `parseCallExpression` |
| `IF` | `parseIfExpression` | — |
| `FUNCTION` | `parseFunctionLiteral` | — |
:::
::: text never
`{em parseExpression}` never changed.
:::
[show pratt] Here is the finished table. Every kind of expression in Monkey is one row. [hl pratt:6] The open bracket is the only token with two different jobs [hl pratt:4,6] besides minus.

[show hl never] And look at what never changed: `parseExpression`. Ever since the loop went in, every new feature was just one more row in this table.

# Recap
## The parser is finished
::: compare recap
`(` as infix #r1
No new token: `(` after an expression is infix, with the function on its left.
---
`CALL` precedence #r2
The highest, so the call grabs the expression before it.
---
No more TODOs #r3
`let` and `return` keep their values.
:::
::: callout next
Next: the REPL prints the tree for anything you type. Then {em evaluation}: computing `add(1, 2)` = 3.
:::
To recap. [show r1] A call has no new token: the bracket after an expression acts as an infix operator. [show r2] It needs the highest precedence so it grabs the expression right before it. [show r3] And let and return now keep their values.

[show hl next] Your parser is finished. Next in the book, the REPL prints the tree for anything you type, a great way to play with all of this. After that comes evaluation: actually computing add of 1 and 2.
