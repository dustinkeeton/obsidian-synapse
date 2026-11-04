---
name: waffle-init
description: Alias of /waffle-setup — scaffolds `.waffle/waffle.yaml` if missing (never overwrites one), then prints the setup playbook and full stack inventory. Use when the user says "init" or asks to initialize wafflestack in this repo.
user-invocable: true
argument-hint: "(no refs — add --gitignore to also seed the baseline entries — local overlay, local lock, .waffle/avatars/ — into .gitignore)"
---

# Initialize wafflestack in this repo (alias of /waffle-setup)

`wafflestack init` is an **alias of `wafflestack setup`** (#611): the same command, with
byte-identical output. When no config exists at any generation it writes a starter
`.waffle/waffle.yaml` (a scaffold of `targets:` / `stacks:` / `include:` / `config:` /
`eject:`), then prints the agent playbook and toolkit inventory. It **never overwrites** an
existing config; on a configured repo it prints the "Current configuration — update mode"
section instead. Safe to re-run.

## Run it

```bash
npx --yes github:dustinkeeton/wafflestack#v0.19.0 init
```

Pass `--gitignore` through if `$ARGUMENTS` asks for it — that also appends the
stack-independent baseline to `.gitignore`: `.waffle/waffle.local.yaml`,
`.waffle/waffle.local.lock.json` and `.waffle/avatars/` (the worktrees dir is not knowable
yet, since no stack is chosen; `install --gitignore` adds it later):

```bash
npx --yes github:dustinkeeton/wafflestack#v0.19.0 init --gitignore
```

## After it runs

Interpret the output exactly as **`/waffle-setup`** does: report whether a starter was
written (the `wrote …` line on stderr), then recommend stacks from the inventory, surface
prerequisites, and point at **`/waffle-install <ref…>`** to persist the choice and render.
