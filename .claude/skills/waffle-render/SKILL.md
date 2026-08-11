---
name: waffle-render
description: Re-render this repo's current wafflestack selection into harness-native files (.claude/ etc.) and refresh the lock. Use after editing `.waffle/waffle.yaml` or upgrading the toolkit.
user-invocable: true
argument-hint: "(no refs — use /waffle-install to add one; --force overwrites unmanaged collisions; --gitignore adds recommended entries)"
---

# Re-render the current selection

Wraps `wafflestack render` — it regenerates every managed file verbatim from the current
`.waffle/waffle.yaml` selection, refreshes `.waffle/waffle.lock.json`, and **prunes**
previously-managed files that are no longer produced. It takes **no refs** (use
**`/waffle-install`** to add a stack or item — that persists the choice, then renders); bare
`render` re-renders what is already selected.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack render
```

`bake` is a pure alias — `wafflestack bake` is `wafflestack render`, same flags, same behavior.

Pass `--force` or `--gitignore` through only if `$ARGUMENTS` asks (see the collision note below
for when `--force` is appropriate).

## Interpret the result

- **Report the counts.** Relay `rendered N files into <dir>` and any `removed stale: …` line
  (files pruned because the selection dropped them or an item was ejected).
- **Missing required config.** A `config.<stack>.<key>` error means a required key is unset —
  add it to `.waffle/waffle.yaml` `config:` (or `.waffle/waffle.local.yaml` for
  account-specific values) and re-render.
- **Unmanaged-file collision.** The render refuses to overwrite a file it did not write (a
  hand-authored file at a path a render targets), naming every offender and writing **nothing**.
  Do not reach for `--force` reflexively — it discards their content. Explain the collision and
  offer to move the file aside or fold it into a `.waffle/extensions/` file first; `--force`
  only once the user decides the toolkit should own that path.
- **Never hand-edit the output.** The rendered `.claude/` tree is generated — a local edit is
  drift (**`/waffle-doctor`** flags it, and this render restores it). Add project-specific
  guidance through `.waffle/extensions/` instead.
