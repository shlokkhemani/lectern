---
title: bullets fixture
lang: go
---

# Precedence
## Calls bind tightest
::: code prec @left src=../../examples/part8/src/parser/parser.go:22-32 "parser/parser.go"
::: bullets why
- `(` after an expression is an infix operator.
- It gets the highest precedence, `CALL`.
- So `add(1)` groups before `+` can grab it.
:::
[hl prec:31] The bracket gets the top level. [show why:1] It is an infix. [show hl why:2] It is the highest. [show hl why:3] So it groups first.
