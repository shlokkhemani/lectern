---
title: terminal fixture
lang: go
---

# Running the tests
## The parser passes
::: terminal run @left "~/monkey"
$ go test ./parser
--- FAIL: TestCallExpressionParsing (0.00s)
    parser_test.go:812: want 3 args, got 1
FAIL

$ go test ./parser  #again
ok      monkey/parser   0.214s
:::
::: text note
All three arguments parse:
`add(1, 2 * 3, 4 + 5)`
:::
[show hl run:1] Run the parser tests. [hl run:2-3] The call test fails: it found one argument, not three.

[hl again] After the fix, run them again. [set run:6 ok      monkey/parser   0.198s] They pass.

[dim run:1-4] The failure is history now. [show note] The comma loop did it.

## A longer session
::: terminal log @left "zsh"
$ go build ./...
$ ./monkey
>> let add = fn(a, b) { a + b };
>> add(1, 2 * 3, 4 + 5)
16
:::
::: callout why
The REPL parses each line with the parser you just finished.
:::
[show log:1] Build it, [show log:2] start the REPL, [show log:3] define add, [show log:4] and call it. [show hl log:5] Sixteen. [show why] Every line went through your parser.
