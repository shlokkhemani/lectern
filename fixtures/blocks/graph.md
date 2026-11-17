---
title: graph fixture
lang: go
---

# From text to value
## The interpreter pipeline
::: graph flow "the pipeline"
src: source
lex: lexer
par: parser
ev: evaluator
out: value
src -> lex: characters
lex -> par: tokens
par -> ev: AST
ev -> out
:::
[grow flow:1-4,src>lex,lex>par,par>ev] Text goes in at the left. [hl flow:lex] The lexer cuts it into tokens, [hl flow:par] the parser builds a tree, [hl flow:ev] and the evaluator walks it.

[show hl flow:out] Out comes a value. [dim flow:src] The source is long gone by then.

## Who calls whom
::: graph calls dir=TB
repl: repl.Start
lex: lexer.New
par: parser.New
env: NewEnvironment
prog: ParseProgram
eval: Eval
repl -> lex
repl -> par
repl -> env
lex -> prog: tokens
par -> prog
prog -> eval: AST
env -> eval
:::
::: text note @left
`ParseProgram` is called once per line you type.
:::
[hl calls:repl] The REPL starts everything. [hl calls:prog] Parsing happens here, [show hl note] once per line.

## A cycle with no root
::: graph loop dir=TB
va: a
vb: b
oa: object a
ob: object b
va -> oa  #pa
vb -> ob  #pb
oa -> ob  #ab
ob -> oa  #ba
:::
[hl loop:ab,ba] Two objects point at each other. [hide loop:pa,pb] Drop both variables, [hl loop:oa,ob] and no root reaches the loop.

## One loop, four parts
::: graph pump dir=cycle
evap: Evaporator
comp: Compressor
cond: Condenser
valve: Valve
evap -> comp: cold vapour
comp -> cond: hot vapour
cond -> valve: warm liquid
valve -> evap: cold liquid
:::
[grow pump:evap] The evaporator takes heat in. [grow pump:comp] The compressor heats it. [grow pump:cond] The condenser gives it out, [grow pump:valve] and the valve starts it over.
