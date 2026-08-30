# Third-Party Notices

## Comet (github.com/zeronsh/comet)

Portions of `crates/helper/src/markdown/` (block-level markdown parsing and
gpui rendering of the parse tree) are ported from Comet, MIT License,
Copyright 2026 Wing:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.

Upstream sources of the port:
- `crates/ui/src/markdown/{parser.rs,render.rs}` — markdown parse and
  gpui rendering (crates/helper/src/markdown/{parser,render}.rs).
- `crates/syntax/src/lib.rs` — tree-sitter highlighting contracts
  (crates/helper/src/markdown/syntax.rs), with a reduced grammar set.
- `crates/theme/src/builtins.rs` (`syntax()` mapping, zeron-dark palette) —
  token-color table (crates/helper/src/markdown/render.rs `SyntaxPalette`).
- `crates/ui/src/changes.rs` (`LineKind`) — per-line unified-diff
  classification only (crates/helper/src/markdown/diff.rs); the Changes-
  pane machinery around it is NOT ported.

All at version 0.2.28. Adaptations for solid-gpui are marked in each
file's header (streaming/mend/veil machinery removed; theme narrowed to a
fixed palette; grammar subset bundled with typed fallback).

## lxsmnsyc/solid-gpui (github.com/lxsmnsyc/solid-gpui)

The universal `Dynamic` component in `packages/solid/src/jsx.ts` is ported
from lxsmnsyc/solid-gpui, MIT License, Copyright 2026 lxsmnsyc:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.

Upstream source of the port:
- `packages/solid-gpui/src/index.ts` (`DynamicProps` + `Dynamic`) —
  accessor-returning component swap (packages/solid/src/jsx.ts), adapted to
  this repo's JSX types and bindings. The mock-host IDEA
  (`scripts/mock-host.mjs`) is credited in its header; the implementation is
  independent and speaks this project's protocol.

All at the 2026-08 main branch. This project is an independent clean-room
implementation in the same niche; see docs/comparison.md for the positioning.

## Other dependencies

Runtime dependencies of the helper binary are listed in
`crates/helper/Cargo.toml` (gpui — Apache-2.0, zed-industries/zed; xcap;
pulldown-cmark; serde_json; futures). License texts for crates.io
dependencies are distributed with each crate on crates.io.
