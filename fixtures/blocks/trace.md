---
title: trace fixture
lang: go
---

# Evaluating a call
## Tracing add of 1, 2 times 3, 4 plus 5
::: code body @left "evaluator.go"
func applyFunction(fn, args) Object {
    env := extendFunctionEnv(fn, args)
    result := Eval(fn.Body, env)
    return unwrap(result)
}
:::
::: trace env "env"
fn = add
outer = global
a = 1
b = `2 * 3`
c = `4 + 5`
result = —  #res
:::
[hl body:2] The arguments go into a fresh environment. [show hl env:3-5] One name for each of them.

[set env:b 6] The second argument is evaluated to 6, [set env:c 9] and the third to 9.

[hl body:3] Then the body runs. [set res {ok 16}] The result is 16.

[dim env:3-5] The arguments are done. [hl res] Only the result is left.
