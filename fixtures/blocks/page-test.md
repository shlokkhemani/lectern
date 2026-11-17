---
title: page test
lang: go
---

# Trace
## Moving through tokens
::: tokens tk markers=cur,peek
add ( 1 , 2 ) ;
IDENT LPAREN INT COMMA INT RPAREN SEMICOLON
:::
::: text note
—
:::
[move tk 1] Start at add. [set note leftExp is add] It becomes the left side.

[move tk 3; group tk:3 arg 0 #a0] Then the first argument. [hl tk:3] One.

## Still moving
::: tk
::: callout c
A comma ends the argument.
:::
[move tk 5] The second argument. [show hl c] Commas end arguments.

## A tree
::: tree t "a tree"
call
  add
  1
  2
:::
[grow t] It grows. [hl t:3] One.
