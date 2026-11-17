---
title: Block tour
series: e2e
lang: go
---

<!-- One scene per block type, two motion scenes and three regressions the founder saw in videos.
     test/blocks.test.ts finds scenes by headline order: keep the order, or update SCENES there. -->

##
::: title
A tour of every block
Each one built, drawn and lit
- core
- CS pack
:::
A tour of the blocks, one scene each. [hl _b1:2] Then the packs.

# Core
## Text and callout
::: text t
`parseCallExpression(fn)`
returns a call with its arguments
:::
::: callout c
A call is an {em infix} expression.
:::
[hl t:1] The function comes first. [set t:2 then the {ok arguments}] The arguments follow, [hl c] and a call is an infix.

## Bullets
::: bullets b
- the bracket is an infix
- it binds tightest
- so it groups first
:::
[show b:1] It is an infix. [show hl b:2] It binds tightest. [show hl b:3] So it groups first.

## Checklist
::: checklist todo
- [x] prefix operators
- [ ] call expressions #calls
- [ ] let and return
:::
[hl calls] Calls are next. [set calls done] Now they are done.

## Compare
::: compare pa
parameters
names the function waits for
---
arguments
values it is called with
:::
[hl pa:1] Parameters are names. [hl pa:2] Arguments are values.

## Table
::: table ex
| call | arguments |
|---|---|
| `add(2, 3)` | two numbers |
| `add(2 + 2, 3)` | any expression |
:::
[hl ex:1] Two numbers. [hl ex:2; set ex:2.2 an {em expression}] Or any expression.

## Code
::: code parse "parser.go"
func (p *Parser) parseCall(fn Expression) Expression {
    exp := &CallExpression{Function: fn}
    exp.Arguments = p.parseArgs()
    return exp
}
:::
[hl parse:1] The function arrives as an argument. [hl parse:3] The arguments are parsed, [move parse 4] and the node is returned.

## Tree
::: tree ast
call
  function | add
  args
    1
    `2 * 3`
:::
[grow ast:1-2] A call node with its function, [grow ast:3-5] and then its arguments.

## Graph
::: graph flow
src: source
lex: lexer
par: parser
ev: evaluator
src -> lex: text
lex -> par: tokens
par -> ev: tree
:::
[grow flow] Text goes in at the left. [hl flow:par] The parser builds a tree.

## Math
::: math m
f(x) = x^2 + 1
f(3) = 10
:::
[hl m:1] A function of x. [hl m:2] Called with 3, it gives 10.

# CS pack
## Tokens
::: tokens tk markers=cur,peek
add ( 1 , 2 )
IDENT LPAREN INT COMMA INT RPAREN
:::
[move tk 1] The lexer starts on the name. [move tk 2] It steps onto the bracket, [group tk:3-5 the args #args] and the arguments follow.

## Stack
::: stack frames
parseCallExpression
  fn: add
parseArgs #pargs
  args: [] #args2
:::
[hl pargs] The arguments are parsed one by one. [set args2 `[1, 2]`] Two of them.

## Trace
::: trace env
a = 1
b = `2 * 3`
:::
[hl env:a] The first argument is 1. [set env:b 6] The second is evaluated to 6.

## Terminal
::: terminal run "~/monkey"
$ go test ./parser
ok      monkey/parser   0.214s
:::
[show run:1] Run the tests. [show hl run:2] They pass.

## Sequence
::: sequence hs
Client | Server
Client -> Server: SYN #syn
Server -> Client: SYN-ACK #synack
Client -> Server: ACK #ack
:::
[show hl syn] The client sends a SYN. [show hl synack] The server answers, [show hl ack] and the client confirms.

## Custom
::: custom pic
<svg viewBox="0 0 480 160"><rect data-id="box" x="20" y="40" width="160" height="80" rx="8"/><text data-id="label" x="240" y="90" font-size="24">a custom drawing</text></svg>
:::
[hl pic:box] A box, [hl pic:label] and its label.

# Motion
## A planet round its orbit
::: custom sky
<svg viewBox="0 0 640 260"><ellipse id="orbit" cx="320" cy="130" rx="260" ry="100" fill="none" stroke="none"/>
<circle cx="320" cy="130" r="28"/><circle data-id="earth" data-along="orbit" cx="580" cy="130" r="14" fill="var(--ok)"/></svg>
:::
Earth starts on the right of the sun, where the year begins in this drawing. [move sky:earth 0.5] In six months it is on the far side, and it stays there.

## A ball down a curve
::: chart roll "loss"
x: 0 1 2 3 4
loss: 9 4 1 0.5 0.2
point loss 0 #ball
:::
The ball starts at the top of the curve, where the loss is highest of all. [move ball 4] It rolls down to the right, and it rests at the end.

# Regressions
## A chart appears with its first bar
::: chart late "bars arrive later"
first: 3
second: 5
:::
The chart is not on screen yet, nothing is drawn while these first words are spoken. [grow late:first] Now the first bar arrives, [grow late:second] and then the second.

## Each block keeps its own amber
::: bullets left @left
- one on the left
- two on the left
:::
::: bullets right
- one on the right
- two on the right
:::
[hl left:1] The first on the left, [hl right:2] and the second on the right. Both stay lit.

## A tiny log value is never zero
::: chart err log "error per step"
1: 0.0857864
2: 0.0024531
3: 0.0000021239
4: 0.0000000000015949
:::
[grow err] Newton's error falls by powers of ten, step by step.
