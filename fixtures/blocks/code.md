---
title: code fixture
lang: go
---

# Reading the arguments
## Reading the arguments
::: code args @left src=../../examples/part8/src/parser/parser.go:365-366,371-381
::: bullets note
- The loop runs while a comma follows.
- Each pass skips the comma, then parses one argument.
- A missing `)` returns nil: the call is not finished.
:::
[hl args:373; show note:1] The loop runs while a comma follows. [hl args:378; show note:3] Then it expects the closing bracket.

[show hl note:2] Each pass skips the comma and parses one argument. [move args 376] The pointer follows the loop.

## Inline code, diff and gaps
::: code prec diff from=12 "parser/parser.go · book code"
  var precedences = map[token.TokenType]int{
... EQ, NOT_EQ, LT, GT
  	token.PLUS:     SUM,
... MINUS, SLASH, ASTERISK
+ 	token.LPAREN:   CALL,
  }
:::
[hl prec:14] The new row gives the bracket a precedence.
