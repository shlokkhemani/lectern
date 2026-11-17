---
title: small
lang: go
---

# Calls
## The shape of a call
::: text pts
an expression comes first
then the arguments, in brackets
separated by commas
:::
::: text note
`add(2, 3)` is the call you know.
:::
[show pts:1] First, an expression. [show pts:2] Then the arguments. [show pts:3; hl pts:3] Commas between them.

[show note; hl note] That is the whole shape.

## The node
::: code ast @left "ast/ast.go"
type CallExpression struct {
  Token     token.Token
  Function  Expression
  Arguments []Expression
}
:::
::: text fnote
Function is any {em expression}, not just a name.
:::
[hl ast:1-5] The node has the function, and a list of arguments. [hl ast:3; show fnote] Function is any expression.

## Again
::: pts
[hl pts:2] The arguments come second, and [set pts:1 any {em expression} comes first] any expression can be called.
