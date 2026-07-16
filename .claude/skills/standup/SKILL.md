---
name: standup
description: Round up a quick status pulse from every installed agent — each reports in ≤3 lines, strictly from its own role's seat, where the Synapse code stands and where it's headed. Discovers the roster at runtime, fans out one read-only parallel wave, and prints a compact digest — no fixes, no board writes.
user-invocable: true
argument-hint: "[optional focus area]"
---

# Team Standup

Ask every **installed** agent for a quick, role-scoped read on the codebase, then print one compact digest. This is a **read-only pulse**: a single parallel wave of agents, each reporting from its own seat — no fixes, no file edits, no board writes, no task chains.

Unlike `audit` and `docs` (fixed rosters run through a serial task chain), standup **discovers its roster at runtime** and fans out **once, with no barriers**. It reuses their spawn-and-collect scaffold minus the task dependencies.

## Step 1: Enumerate the roster (dynamic — never hard-coded)

Glob the harness **agents** directory — the `agents/` directory beside `.claude/skills` (take `.claude/skills`, swap the trailing `skills` segment for `agents`, and match `*.md`). Under Claude that resolves to `.claude/agents/*.md`.

For each matched file, parse the YAML frontmatter and capture:

- `name` — the agent's `subagent_type`, used to spawn it
- `description` — its role, used to remind it of its seat and to label its digest block

Sort the files alphabetically by `name`; this is the **roster order** used for both spawning and the digest. Skip any file whose frontmatter has no `name`. Do **not** fall back to a hard-coded roster, the `waffle.lock.json` `files` map, or a config table — the glob reflects what is actually rendered into this repo.

**Empty roster** → if no agent files are found, report "No installed agents to round up." and stop.

## Step 2: Round-up — one parallel read-only wave

Spawn **every** rostered agent in a **single message** — one `Agent` call each, all in that one message — so they run concurrently as one wave. Do **not** create a team and do **not** create tasks: this skill has no coordination barriers and no side effects. (`run_in_background: true` is fine for a large roster; the point is that the whole wave goes out at once.)

Give each agent `subagent_type: "<name>"` and this prompt, filling in `<name>`, `<description>`, and the focus clause:

> **Standup — `<name>`.** You are the `<name>` agent (<description>). Give an **extremely brief** status pulse on the Synapse codebase **strictly from your own role's perspective** — the view from your seat, nothing else.
>
> - **≤3 lines total.** No preamble, no headings, no sign-off.
> - First line(s): where the code **stands** in your area right now. Final line: where it's **headed** — what you'd flag or expect next.
> - **Stay in your lane.** A PM talks backlog and priorities; a docs agent talks doc drift; a planner talks sprint/tracking health; a QA agent talks test health. **No cross-role commentary.**
> - This is **read-only**. Read whatever you need, but do **not** edit files, apply fixes, create tasks, or write to any board.
> - Output **only** your ≤3-line report. It IS your return value — not a message to anyone; do not call `SendMessage` or `TaskUpdate`.
> <focus clause>

**Focus clause** — when `$ARGUMENTS` is provided, append this line to the prompt: `> - Focus your read on: $ARGUMENTS (still strictly within your role).` Otherwise omit it.

**Collect via return values.** Most specialists are "silent" — they carry no `SendMessage`/`TaskUpdate` tools — so never wait on a message or a task update from them. Each agent's **final message is its report**: read it directly from the returned tool result as the agent completes.

## Step 3: Digest

Once every agent has returned, assemble one compact standup — **one block per agent, in roster order**:

```
## Standup — Synapse

**`<name>`** — <role in a few words>
<the agent's ≤3-line report>

**`<next-name>`** — …
```

- Preserve roster (alphabetical) order.
- **Truncate** any over-long reply to its first 3 lines (append ` …` when cut) so one chatty agent can't blow up the digest.
- If an agent failed or returned nothing, show `**<name>** — (no report)` and move on — one silent agent never blocks the round-up.

Print the digest and stop. **No board writes, no file edits, no follow-up tasks** — the pulse is the whole deliverable.
