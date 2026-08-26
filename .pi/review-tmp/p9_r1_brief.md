# P9 review brief (r1) — native macOS menu bar

## Context

Repo: solid-gpui. Commit under review:
- 5958cae feat(helper): native macOS menu bar (P9)

P9 per PLAN: menu/item/separator with REAL shortcuts; macOS-only polish.
Design (settled in recon): setMenus rides the P4 command channel (menus are
app chrome, not tree ops); picks come back as a NEW app-level Event variant
{type:"menu",itemId} — NOT a sentinel element id (invariant 7: ElementId 0
does not exist).

## What changed (verify against the diff)

1. Protocol: Command::SetMenus {seq, menus: Vec<MenuSpec>}; MenuSpec/
   MenuItemSpec (serde tag "type": item{label,id,keystroke?,disabled?,
   checked?,osAction?}/separator/submenu recursive); OsActionKind closed
   enum (cut/copy/paste/selectAll/undo/redo). Event::Menu{item_id} second
   wire event shape; element_id()/event_type() now Option-returning.
   Name list gains "setMenus" in BOTH layers (the matches! gate AND the
   unknown-command message — check both).
2. TS: command.ts decode branch + KNOWN list + encodeCommand branch
   (getStats fallback is the live P4 trap); event.ts SolidGpuiEvent union
   with menu short-circuit decode; menus.ts registry (callbacks stripped
   before send, atomic rebuild per set, handleEvent consumes before element
   routing in render.ts); RenderHandle.menus.set sugar; protocol index
   re-exports.
3. Helper: MenuAction derives Action #[action(no_json)]; single global
   on_action handler → write_event_line(Menu); KeyBinding dedupe via
   MenuState Global (bind_keys has no removal — rebinding would accumulate);
   cx.set_menus wholesale replace; os_action maps to native selectors
   (macOS performs them; NO JS event fires for those picks — documented);
   AsyncApp::update infallible here (returns R).
4. Tests: Rust round-trip full-surface + optionals-off-wire + menu-event
   wire shape + accessor Options; TS decode/encode round-trips through the
   real encoder + malformed rejections; menus.test.ts registry semantics;
   GUI smoke window_mode_set_menus_applies_and_replaces (two set calls,
   result replies exact-match).
5. Demo: examples/menus.tsx (File/Edit bar, swap button, pick status).

## Invariants to actively check

- A. Lockstep: BOTH command-name layers Rust-side; TS KNOWN; encode/decode
  pair symmetric incl. optional-absence (skip_serializing_if parity).
- B. Sentinel ban: menu events genuinely carry no element id anywhere;
  client demux order reply→event→menu? (check client.ts line ~133 flow —
  decodeReply first, then decodeEvent which handles both shapes).
- C. Registry lifecycle: stale ids die on set(); osAction items never
  register pickers (they cannot fire); unknown-id warn consumes.
- D. Binding accumulation: same keystroke+id across repeated set() calls
  must NOT rebind (dedupe key format); different id same keystroke WILL
  add a shadowing binding — is that documented/acceptable?
- E. The two host.rs test matches + one let-else were made exhaustive for
  Event::Menu — confirm no production match still assumes Input-only.
- F. GUI smoke asserts result replies only; actual CLICK dispatch through
  NSMenu is untestable headless — note the gap honestly.

## Evidence you can run

- bun run test (161), bun run typecheck
- cargo test -p solid-gpui-protocol -p solid-gpui-helper (exit codes!)
- cargo clippy --all-targets (exit 0), cargo fmt --all -- --check
- Demo (GUI, optional): bun run example/menus (~15s self-dispose)

## Verdict format

CLEAN, or Blocker/Major/Minor with path:line evidence naming the invariant.
IMPORTANT: your FINAL message must BE the verdict report — budget so the
report gets written.
