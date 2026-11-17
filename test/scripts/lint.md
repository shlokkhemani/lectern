---
title: honest lint
---

# Opening
## Tiny and overlapping
::: custom pic
<svg viewBox="0 0 400 120"><g transform="scale(0.4)"><text x="10" y="40" font-size="20">far too small</text></g><text x="20" y="90" font-size="24">CLOSED</text><text x="30" y="96" font-size="24">SYN-SENT</text></svg>
:::
A drawing.

## Twenty numbers
::: tokens arr markers=lo,mid,hi
2 5 8 12 16 23 38 42 56 61 72 77 85 91 93 95 97 98 99 64
0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19
:::
[move arr:lo 10; move arr:mid 10; move arr:hi 10] All three meet.

## Too many
::: tokens long
alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma
:::
Too many.

## Squeezed
::: custom sq
<svg viewBox="0 0 900 200"><g transform="scale(4 0.25)"><text x="10" y="200" font-size="16">squeezed flat</text></g><g transform="scale(0.25 4)"><text x="2000" y="20" font-size="16">squeezed thin</text></g><text x="20" y="190" font-size="20">fine</text></svg>
:::
Squeezed.

## Hug
::: bullets hug
- A first point long enough that it has to wrap onto a second line at the measure
- Short
:::
Hug.

## Overfull
::: tokens long2
alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma
:::
::: custom pic2
<svg viewBox="0 0 400 120"><text x="20" y="90" font-size="24">CLOSED</text><text x="30" y="96" font-size="24">SYN-SENT</text></svg>
:::
Overfull.

## Captions
::: checklist cl "steps"
- [ ] parse
- [x] lex
:::
::: tokens ct "input"
a + b
:::
::: stack cs @left "frames"
main
  x: 1
:::
::: table cta @left "cases"
| a | b |
|---|---|
| 1 | 2 |
:::
Captions.

## Scaled
::: text one
A plain line of text.
:::
::: callout oc
A callout.
:::
Scaled.

## Two too wide
::: code wide @left
let total = computeTheSumOfAllTheValuesInThisList(values, initial, options)
:::
::: table wt
| first column header | second column header | third one |
|---|---|---|
| a fairly long cell value | another long cell value | x |
:::
[hl wt:1] Two too wide.

## Two too wide, one @top
::: code wide2 @top
let total = computeTheSumOfAllTheValuesInThisList(values, initial, options)
:::
::: table wt2
| first column header | second column header | third one |
|---|---|---|
| a fairly long cell value | another long cell value | x |
:::
[hl wt2:1] Fixed.

## A wide graph
::: graph wg
a: the first long step
b: the second long step
c: the third long step
d: the fourth long step
e: the fifth long step
a -> b
b -> c
c -> d
d -> e
:::
Too wide.

## The same graph, top to bottom
::: graph wg2 dir=TB
a: the first long step
b: the second long step
c: the third long step
d: the fourth long step
e: the fifth long step
a -> b
b -> c
c -> d
d -> e
:::
Fits.

## Callout beside code
::: code ops @left
def add(self, word):
    for seed in range(self.hash_count):
        index = self.hash(word, seed) % len(self.bits)  # one index per hash function
        self.bits[index] = 1
:::
::: callout rule
A bit that is set never goes back to zero, so a word that was added is always found.
:::
Squeezed.

## The same, code on top
::: code ops2 @top
def add(self, word):
    for seed in range(self.hash_count):
        index = self.hash(word, seed) % len(self.bits)  # one index per hash function
        self.bits[index] = 1
:::
::: callout rule2
A bit that is set never goes back to zero, so a word that was added is always found.
:::
Fixed.

## Bullets beside a growing graph
::: bullets what @left
- local variables
- global variables
- values held in registers
:::
::: graph heap dir=LR
stack: stack
user: user object
settings: settings object
stack -> user
user -> settings
:::
Bullets.

## Compare beside a checklist
::: compare cmp @left
Meets it for the first time
In bed for about a week
---
Has met it before
Barely notices
:::
::: checklist rc
- [x] antigen: the shape that gets recognised
- [x] B cells that fit are copied into an army
:::
Compare.

## A tall graph
::: graph tall dir=TB
a: one
b: two
c: three
d: four
e: five
f: six
g: seven
h: eight
a -> b
b -> c
c -> d
d -> e
e -> f
f -> g
g -> h
:::
Tall.

## A formula with a script in an exponent
::: math formula @top
E_A = \dfrac{1}{1 + 10^{(R_B - R_A)/400}}
:::
::: chart curve format=#% "expected score, by rating gap"
x: -800 -600 -400 -200 0 200 400 600 800
expected: 1 3 9 24 50 76 91 97 99
:::
Formula.

## Overfull, with tiny text too
::: tokens long3
alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma
:::
::: custom pic3
<svg viewBox="0 0 400 120"><text x="20" y="90" font-size="8">tiny</text></svg>
:::
Overfull again.

## A formula ending in a subscript
::: math sub
x_i
:::
Subscript.

## Two blocks too tall together
::: bullets tb1
- one
- two
- three
- four
:::
::: graph tb2 dir=TB
a: one
b: two
c: three
d: four
a -> b
b -> c
c -> d
:::
Together.
