---
title: more lint
lang: go
---

# Lint
## Sets the chart cannot draw
::: chart bad @left
a: 1
b c: 2
:::
::: chart grp
series: noon sunset
blue: 80 2
:::
::: chart lg log
x: 1 2 3
s: 1 10 100
:::
[set bad:a foo] One, [set bad:2 1 2] two, [set grp:blue 90 30] three, [set lg:s 0 10 100] four, [set lg:s 1 2] five.

## Text that lands on text
::: custom clash
<svg viewBox="0 0 400 120">
<line id="l" x1="50" y1="70" x2="350" y2="70"/>
<text x="350" y="40" text-anchor="middle" font-size="16">Goal</text>
<g data-id="tag" data-along="l"><circle cx="50" cy="70" r="6" fill="currentColor"/><text x="50" y="40" text-anchor="middle" font-size="16">Here</text></g>
</svg>
:::
The tag starts on the left. [move clash:tag 1] It lands on the goal.

## Text that passes text
::: custom pass
<svg viewBox="0 0 400 120">
<line id="l" x1="50" y1="70" x2="350" y2="70"/>
<text x="200" y="40" text-anchor="middle" font-size="16">Middle</text>
<g data-id="tag" data-along="l"><circle cx="50" cy="70" r="6" fill="currentColor"/><text x="50" y="40" text-anchor="middle" font-size="16">Here</text></g>
</svg>
:::
[move pass:tag 1] It passes the middle.

## A ring too crowded for its chord labels
::: graph crowd dir=cycle
a: one
b: two
c: three
d: four
e: five
a -> c: a long chord label
a -> d: another long label
b -> d: a third long label
b -> e: a fourth long label
c -> e: a fifth long label
:::
Seven.

## The same ring, unlabelled
::: graph bare dir=cycle
a: one
b: two
c: three
d: four
e: five
a -> c
a -> d
b -> d
b -> e
c -> e
:::
Eight.

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

## A tree with node captions
::: tree split "Split by the truth"
1,000 people
  sick | 10
  healthy | 990
:::
[grow split] Split the thousand by the truth.

