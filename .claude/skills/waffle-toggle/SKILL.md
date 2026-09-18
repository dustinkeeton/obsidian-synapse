---
name: waffle-toggle
description: Toggle whether an agent may invoke a rendered wafflestack skill on its own judgment (Claude Code's `disable-model-invocation`), per skill and per project. Use when a skill such as /audit or /delegate should fire only as an explicit slash command, or to hand one back to the agent; the choice is persisted in .waffle/waffle.yaml and re-rendered. Pass --disable/--enable — the picker needs a TTY.
user-invocable: true
argument-hint: "[--disable <skill>…] [--enable <skill>…] (no flags prints the current table; from an agent always pass flags)"
---

# Toggle agent invocation per skill

Wraps `wafflestack toggle`. Every rendered skill is a slash command; whether an **agent** may also
fire it unprompted is Claude Code's `disable-model-invocation` frontmatter key. The toolkit renders
each `SKILL.md` byte-for-byte from the stack source, so that key is the stack author's call — until
a project overrides it here. The override is a project-level config block:

```yaml
skills:
  modelInvocation:
    disabled: [audit, delegate]   # rendered with `disable-model-invocation: true`
    enabled: [some-skill]         # rendered WITHOUT the key even though the source sets it
```

It flows through config → render → lock like every other input, so `doctor` stays clean and the
override is part of the canonical render. **Only the `claude` target has the key**: under codex and
agents-dir the cross-tool `.agents/skills/` copy renders the source unchanged, and the CLI says so.

## See the current state

```bash
npx --yes github:dustinkeeton/wafflestack#v0.16.1 toggle
```

Without a TTY (which is how you, the agent, run it) this prints a table — one row per rendered
skill, `agent-invocable` or `slash-only`, with `(source)` or `(override)` saying who decided — and
never opens a prompt. Read it before changing anything: the user may be asking about a skill that
is already in the state they want. In a human's terminal the same command opens a checkbox picker
(checked = an agent may fire it; `enter` applies, `esc` leaves the config untouched).

## Apply the change

Pass the skills from `$ARGUMENTS` as flags — repeatable, and either flag skips the picker:

```bash
npx --yes github:dustinkeeton/wafflestack#v0.16.1 toggle --disable audit --disable delegate
```

```bash
npx --yes github:dustinkeeton/wafflestack#v0.16.1 toggle --enable audit
```

The CLI writes the block to the **committed** `.waffle/waffle.yaml` (never the local overlay —
this is shared project policy), keeps it minimal (a skill lands in a list only where it differs from
its source), then re-renders so the rendered `SKILL.md` and the lock move together. Then:

- **`rendered N files`** — done. The rendered skill's frontmatter now carries (or no longer
  carries) `disable-model-invocation: true`; the skill is still on the cheat sheet, still
  user-invocable. If this repo commits its render, commit `.waffle/waffle.yaml`, the lock, and the
  rendered skill together.
- **`no change`** — every named skill was already in that state; nothing was written.
- **`is not a rendered skill`** — the name is not in this repo's render. The rendered names are
  listed; externally installed skills (a harness plugin living outside the repo, say) are out of scope —
  the toolkit never tracks them.
- **`does not render`** — the selection in `.waffle/waffle.yaml` already fails (an unresolvable
  ref, say); the problems are listed. Fix those first, then retry. Nothing was written.
- **A refusal naming a pinned command** — the toolkit that ran is not a release; run the exact
  pinned command it prints. Nothing was written.

Do not edit the rendered `SKILL.md` by hand to get the same effect: `doctor` flags it as drift and
the next `render` overwrites it. The config block is the supported knob; `/waffle-render` re-applies
it on every render.
