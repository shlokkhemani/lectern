---
title: table fixture
lang: go
---

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
[show hl ex:1] The shape is: an expression, then a list of expressions in brackets.

[show hl ex:2] The arguments do not have to be plain numbers.

[show hl ex:3] The thing being called does not have to be a name either.

[show hl ex:4] And because functions are values, you can pass one in as an argument.

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
[show pratt] Here is the finished table. [hl pratt:6] The open bracket is the only token with two different jobs [hl pratt:4,6] besides minus.

[show never] And look at what never changed.
