---
title: custom svg fixture
---

# Messages
## Two arrows, one marker id
<!-- Both scenes declare <marker id="ah">: ids are scoped per block, so each arrowhead resolves in its own SVG. -->
::: custom open "client and server"
<svg viewBox="30 0 500 200">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs>
  <text x="80" y="20" text-anchor="middle" font-size="22">Client</text>
  <text x="480" y="20" text-anchor="middle" font-size="22">Server</text>
  <line x1="80" y1="36" x2="80" y2="196" style="stroke: var(--line)"/>
  <line x1="480" y1="36" x2="480" y2="196" style="stroke: var(--line)"/>
  <g data-id="syn"><path d="M80 70 L478 100" stroke-width="2" marker-end="url(#ah)"/><text x="280" y="72" text-anchor="middle">SYN</text></g>
  <g data-id="ack" class="ok"><path d="M480 130 L82 160" stroke-width="2" marker-end="url(#ah)"/><text x="280" y="132" text-anchor="middle">SYN-ACK</text></g>
</svg>
:::
[show hl open:syn] The client sends a SYN. [show hl ack] The server answers.

## The same id again
::: custom stale "an old packet"
<svg viewBox="30 0 500 200">
  <defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs>
  <text x="80" y="20" text-anchor="middle" font-size="22">Client</text>
  <text x="480" y="20" text-anchor="middle" font-size="22">Server</text>
  <line x1="80" y1="36" x2="80" y2="196" style="stroke: var(--line)"/>
  <line x1="480" y1="36" x2="480" y2="196" style="stroke: var(--line)"/>
  <g data-id="old" class="bad"><path d="M80 70 L478 100" stroke-width="2" stroke-dasharray="8 6" marker-end="url(#ah)"/><text x="280" y="72" text-anchor="middle">old SYN</text></g>
  <g data-id="syn"><path d="M80 130 L478 160" stroke-width="2" marker-end="url(#ah)"/><text x="280" y="132" text-anchor="middle" fill="var(--ink-2)">SYN</text></g>
</svg>
:::
[show old] A stale SYN arrives. [show hl stale:syn] Then the real one.
