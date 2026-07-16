---
name: waffle-eject
description: Stop wafflestack managing one item (skill/agent/file) and hand it to the project. Confirm first — the file stays in place but becomes project-owned and stops receiving toolkit updates.
user-invocable: true
argument-hint: "<skills/NAME | agents/NAME | files/PATH>"
---

# Eject an item from management

Wraps `wafflestack eject <ref>` — it releases a rendered item from the frozen-image contract:
the file(s) **stay in place** but are removed from `.waffle/waffle.lock.json` and become
**project-owned**, and the ref is dropped from `include:` / added to `eject:` so a later render
won't reproduce or prune it. After this, `/waffle-render` leaves the file untouched and
`/waffle-doctor` stops tracking it.

## Confirm before running

Ejecting is a deliberate handoff, not a quick toggle — the item **stops receiving toolkit
updates and fixes** and its config placeholders freeze at their last-rendered values. Before
running:

1. **Require a ref.** `$ARGUMENTS` must name exactly one item —
   `skills/<name>`, `agents/<name>`, or `files/<repo-relative-path>`. If it's missing or
   ambiguous, ask (or run **`/waffle-setup`** to list valid refs) rather than guessing.
2. **State the consequence and get a yes.** Tell the user which file(s) will be released and
   that they'll own them going forward (no more updates), then confirm. If they only want to
   *tweak* an item, steer them to a `.waffle/extensions/` file instead — that keeps the item
   managed while appending project guidance.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack eject <skills/NAME | agents/NAME | files/PATH>
```

## After it runs

- Report the released file(s) — they remain on disk, now project-owned.
- Confirm `.waffle/waffle.yaml` recorded the eject (and that any matching `include:` entry was
  dropped, so it isn't left orphaned).
- Note that re-adopting the toolkit's version later means removing the `eject:` entry (and
  re-installing if needed), then re-rendering — possibly over your now-project-owned edits.
