---
title: custom fixture
lang: go
---

# Pointers
## A pointer to a value
::: custom mem "memory"
<svg width="560" height="180" viewBox="0 0 560 180">
  <text x="80" y="24" text-anchor="middle" style="fill: var(--ink-3)">stack</text>
  <text x="440" y="24" text-anchor="middle" style="fill: var(--ink-3)">heap</text>
  <g data-id="p">
    <rect x="0" y="56" width="160" height="72"/>
    <text x="80" y="100" text-anchor="middle" font-size="22">p</text>
  </g>
  <path data-id="ptr" d="M160 92 H320"/>
  <g data-id="obj">
    <rect x="320" y="40" width="240" height="104"/>
    <text data-id="val" x="440" y="100" text-anchor="middle" font-size="26">42</text>
  </g>
</svg>
:::
::: code prog @left
x := 42  // a value on the heap
p := &x  // p holds its address
*p = 43  // write through p
:::
[hl prog:1] A value lives on the heap. [show hl obj] Here it is.

[hl prog:2] p holds its address, [show hl p] the box on the stack, [show hl ptr] pointing across.

[hl prog:3] Writing through p [set val 43] changes the value itself.

[dim p] The pointer did not change; [hl obj] the object did.

## Plain HTML
::: code fn @left
// add returns the sum of two integers
fn add(a, b) {
  return a + b
}
:::
::: custom card
<div style="display: flex; gap: 48px">
  <div data-id="in"><b>input</b></div>
  <div data-id="arrow">→</div>
  <div data-id="out"><code>add(1, 2)</code></div>
</div>
:::
[hl in] The input, [hl out] the output, [hl fn:3] computed here.

## A picture from a file
::: custom pair "two boxes, read from custom-pair.svg" src=custom-pair.svg
[show hl a] One box, [show hl link] a link, [show hl b] and the other.
