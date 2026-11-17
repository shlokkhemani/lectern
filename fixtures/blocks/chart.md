---
title: chart fixture
---

# How fast is it
## Where the time goes
::: chart t "milliseconds per phase, 10k lines" format=#ms
lexer: 34.0
parser: 61.0  #big
evaluator: 55.5
printer: 6.1
:::
[grow t] Each phase takes its share. [hl big] The parser takes the longest, [set big 82.5] and with error recovery on, longer still.

[hide t:4] Printing is so fast [show t:4] it barely registers, [dim t:4] and the parser [hl big] dominates.

## Calls per second, in thousands
::: trace gain @left
speedup = 8.6x
:::
::: chart c
x: v1 v2 v3 v4 v5
tree: 4 5 6 6 7
bytecode: 4 12 25 41 60
:::
[grow c:bytecode] The bytecode machine climbs with every version. [show hl c:tree] The tree walker started level, [set c:tree 4 5 6 8 9] and barely moves.

[dim c:tree] That gap [hl c:bytecode] is the case for a compiler.

# Money
## Starting ten years earlier
::: chart race "balance by age, 7% a year" format=$
x: 25 30 35 40 45 50 55 60 65
Ella: 0 31000 74000 104000 145000 204000 286000 401000 563000
Leo: 0 0 0 31000 74000 134000 219000 338000 505000
mark 35: Ella stops, Leo starts  #stop
point Ella 65  #top
:::
[grow race:Ella] Ella saves from twenty five. [show hl stop] At thirty five she stops, [grow race:Leo] and Leo starts. [show hl top] At sixty five she has more.

## A one percent fee
::: chart fee "$100,000 over 30 years" format=$
x: 0 5 10 15 20 25 30
gross: 100000 140000 197000 276000 387000 543000 761000
net: 100000 134000 179000 240000 321000 429000 574000
band gross net: {bad lost to fees}  #gap
:::
[grow fee:gross] Without fees it grows to seven hundred and sixty thousand. [grow fee:net] With one percent, far less. [show hl gap] The gap is what the fee took.

## Two charts side by side
::: chart near @left "sunlight reaching Earth, July = 100"
July, farthest: 100
January, closest: 107
:::
::: chart total "daily sunlight, watts per square metre"
June 21: 499
March 20: 332
December 21: 151
:::
[grow near] Distance changes sunlight by 7 percent. [grow total] The tilt changes it by more than three times.

## Rates
::: chart r "yearly return" format=#%
x: 2019 2020 2021 2022 2023 2024
stocks: 28.9 16.3 26.9 -18.1 26.3 25
bonds: 8.7 7.5 -1.5 -13 5.5 1.3
mark 2022: rates rise
point bonds 2022
:::
[grow r:stocks,bonds] Two kinds of asset. [show hl r:mark1] In 2022 both fell, [show r:point1] bonds the hardest in decades.

## Distance to the Sun
::: chart sun "distance to the Sun, million km"
x: Jan Mar May Jul Sep Nov
distance: 147.1 148.5 151 152.1 150.5 148
:::
[grow sun] Earth is closest in January and farthest in July: the axis spans the data, not 0 to 152.

# Chart features
## Axis titles
::: chart curve "expected score, by rating gap" format=#% x="rating gap" y="expected score"
x: -800 -600 -400 -200 0 200 400 600 800
expected: 1 3 9 24 50 76 91 97 99
mark 400: 10 to 1
point expected 0: even match
:::
[grow curve] The curve depends only on the gap. [hl curve:point1] An even match sits at one half.

## A log axis
::: chart response "antibody level, days after exposure" log x="days after exposure" y="antibody level"
x: 0 4 8 12 16 20 24 28
first: 1 1 3 10 8 6 5 4
second: 1 30 900 1000 950 850 800 750
band first second: the protection gap
:::
[grow response:first] The first response is slow. [grow response:second] The second climbs a hundred times higher.

## Grouped bars
::: chart sky "share of sunlight that gets through" format=% x="share that gets through" y="colour"
series: noon sunset
blue: 80 0.02
red: 96 24
:::
[grow sky] Two colours, two times of day. [hl sky:blue.sunset] Almost no blue survives sunset, [hl sky:red] while a quarter of the red does. [set sky:red.sunset 30] With clean air, more.

## Log bars
::: chart bombs "energy released as shaking" log x="Hiroshima bombs"
magnitude 6: 1
magnitude 7: 32
magnitude 8: 1000
magnitude 9: 32000
:::
[grow bombs:1] A six is about one bomb. [grow bombs:2] A seven, thirty two. [grow bombs:3] An eight, a thousand, [grow bombs:4] and a nine, thirty two thousand. [hl bombs:4] Each step is the same length: thirty two times more.
