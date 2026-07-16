---
name: waffle-init
description: Scaffold a starter `.waffle/waffle.yaml` so wafflestack can render into this repo. Use in a repo that has never run wafflestack, before picking stacks and running /waffle-render.
user-invocable: true
argument-hint: "(no refs — add --gitignore to also seed .waffle/waffle.local.yaml into .gitignore)"
---

# Initialize wafflestack in this repo

Wraps `wafflestack init` — it writes a starter `.waffle/waffle.yaml` (a scaffold of
`targets:` / `stacks:` / `include:` / `config:` / `eject:`) so this repo can be rendered.
It **errors if a config already exists** at any generation, so it is safe to run only once.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack init
```

Pass `--gitignore` through if `$ARGUMENTS` asks for it — that also appends
`.waffle/waffle.local.yaml` to `.gitignore` (nothing else is knowable yet, since no stack is
chosen):

```bash
npx --yes github:dustinkeeton/wafflestack init --gitignore
```

## After it runs

1. Report the file it wrote (`.waffle/waffle.yaml`).
2. Explain the next two steps and offer to do them:
   - **Pick stacks + config.** Edit `.waffle/waffle.yaml` — set `targets:` (usually
     `[claude]`), list `stacks:` (run **`/waffle-setup`** to see the full inventory and each
     stack's required config), and fill `config:` values. `/waffle-install <ref…>` can do the
     stack/config edit and render in one step.
   - **Render.** Run **`/waffle-render`** (or `/waffle-install`) to generate the harness files.
3. If the command reported that a config already exists, do **not** overwrite it — point the
   user at the existing `.waffle/waffle.yaml` and suggest `/waffle-setup` (update mode) instead.
