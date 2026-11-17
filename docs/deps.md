# Dependencies

One line each: what it is for, and why it is worth having.

## Render (L4)
- `puppeteer-core`: drives Chrome over CDP for capture; no bundled browser.
- `@puppeteer/browsers` (comes with puppeteer-core; should be listed in package.json): installs the pinned `chrome-headless-shell` 157.0.8103.50 into `~/.cache/lectern/chrome/` on first run. Pinning costs one ~15 s, ~215 MB download, so every machine renders with the same engine. That matters because captures are compared byte for byte, and system Chrome auto-updates.
- `ffmpeg` / `ffprobe` (PATH, not npm): segment encode with libx264, AAC, mux, and frame and sample verification.

## Runtime and blocks (L2)
- `shiki` (compile time only, in `code.prepare`; never in the page): TextMate-grade tokens for every language with scopes, which `code` maps onto the theme's six syntax roles. Uses its JavaScript regex engine, because Bun lacks the `DecompressionStream` the wasm engine needs.
- `d3-flextree` (in the page): tidy-tree layout for nodes of different sizes (rulings 12: nodes size to their label), which plain d3-hierarchy cannot do.
- `@dagrejs/dagre` (in the page): layered layout for `graph` (boxes and arrows), with edge routing that keeps edges off nodes.
- `katex` (compile time only, in `math.prepare`): renders equations to static markup, so the page does no math typesetting at capture time.
- `@types/d3-flextree`, `@types/katex` (dev): types for the above.
