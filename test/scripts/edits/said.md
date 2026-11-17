---
title: edits
lang: go
say:
  AST: abstract syntax tree
---

# Edits
## The node
::: code ast @left src=ast.go:2-6
::: text pts
the function comes first
then the arguments
:::
[hl ast:4; show pts:1] The AST node holds the function first. [hl ast:5; show pts:2] Then the arguments.

## Commas
::: text commas
`add(2, 3)`
:::
[show commas] Commas separate the arguments.

## A picture
::: custom fig src=shape.svg
[hl fig:fn] A circle for the function, [hl fig:args] and a square for the arguments.

## Again
::: pts
[hl pts:2] The arguments always come second.
