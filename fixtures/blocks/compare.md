---
title: compare fixture
---

# What a call looks like
## Parameters vs arguments
::: compare pa
defining · last video #def
`fn({box a}, {box b}) { a + b }`
{em Parameters}: the names it waits for. Only names, kept as `[]*ast.Identifier`.
---
calling · this video #call
`add({box 1}, {box 2 * 3})`
{alt Arguments}: the values you hand over. Any expression, kept as `[]ast.Expression`.
:::
::: text runs
When the call runs, `{em a}` will hold `{alt 1}` and `{em b}` will hold `{alt 6}`. That happens in the evaluator, later in the book.
:::
[show hl def] Quick vocabulary. When you define a function, the names in brackets are parameters.

[show hl call] When you call a function, the things in brackets are arguments.

[show runs] When the call actually runs, a gets 1 and b gets 6.

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
To recap. [show r1] A call has no new token. [show r2] It needs the highest precedence. [show r3] And let and return keep their values.

[show hl next] Your parser is finished.
