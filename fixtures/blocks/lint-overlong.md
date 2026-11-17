---
title: overlong line
lang: go
---

# Lint
## A code line too long for its column
::: code long @left
args = append(args, p.parseExpression(LOWEST)) // and a comment long enough to need more room
for p.peekTokenIs(token.COMMA) {
}
:::
::: table wide
| `parseIdentifier` · `parseIntegerLiteral` | `parseGroupedExpression` |
| `parsePrefixExpression` | `parseCallExpression` |
:::
[hl long:1] This line cannot fit beside the table.

## The same line alone, which fits
::: code fits
args = append(args, p.parseExpression(LOWEST))
:::
It fits on its own.
