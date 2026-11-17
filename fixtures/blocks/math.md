---
title: math fixture
---

# Precedence as numbers
## Binding power
::: code prec @left
const (
  SUM     // + binds loosely
  PRODUCT // * binds tighter
)
:::
::: math bp
\text{bp}(+) = 1 \qquad \text{bp}(\times) = 2
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}  #sum
1 + 2 \times 3 = 1 + (2 \times 3)
:::
[hl prec:2-3] Each operator gets a precedence, [hl bp:1] a binding power. [show hl bp:3] Higher power binds first.

[hl sum] And the classic sum, [dim bp:1] on its own.

## A derivation
::: math d @left "deriving the sum"
S = 1 + 2 + \cdots + n
S = n + (n - 1) + \cdots + 1
2S = n(n+1)  #twice
:::
::: text why
Write the sum twice, once backwards.
Every column adds up to `n + 1`.
:::
[hl d:1] Write the sum, [show hl d:2] then write it backwards. [show hl twice] Add them: n columns of n plus 1.

[set twice S = \frac{n(n+1)}{2}] Halve both sides, and there is the sum.
