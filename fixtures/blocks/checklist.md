---
title: checklist fixture
lang: go
---

# A finished parser
## What is left to parse
::: checklist todo @left
- [x] prefix and infix operators
- [x] `if` and function literals
- [ ] call expressions  #calls
- [ ] `let` and `return`, completely
:::
::: callout left
Two features left, then the parser is finished.
:::
[hl todo:1-2] Operators and literals are done. [hl calls] Calls are next.

[set calls done] With calls done, [show hl todo:4] only let and return remain.

[set todo:4 done] And now those are finished too.

## Checking it off
::: checklist steps @left
- [ ] register the infix function
- [ ] give the bracket a precedence
- [ ] parse the arguments
:::
::: terminal t "~/monkey"
$ go test ./parser
ok      monkey/parser   0.214s
:::
[set steps:1 done] Register the function, [set steps:2 done] add the precedence, [set steps:3 done] parse the arguments. [hl t:2] The tests pass.

[dim steps:1-2] Those two were one line each. [hl steps:3] The arguments were the real work.
