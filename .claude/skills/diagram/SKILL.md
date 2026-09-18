---
name: diagram
description: Produce an architecture, workflow, sequence, data-flow, or lifecycle/state diagram through the best diagram provider present on this machine — the archify skill when it is installed (interactive standalone HTML), otherwise a Mermaid block embedded in the target doc. Detects the provider at invocation, never installs one, and names the provider it used in the result. Use when a doc needs a system diagram (ARCHITECTURE.md), when asked to visualize architecture, a request flow, an API call sequence, a pipeline, or a state machine, or to turn a Mermaid sketch into a richer form. Invokable by users and agents.
user-invocable: true
argument-hint: "<what to diagram> [into <doc path>] (omit for the current writing task)"
---

# Diagram — one capability, the best available provider

When this skill is invoked, produce the diagram the caller asked for **through the first provider whose detection passes**, then say which provider ran. If invoked with an argument (e.g., `/diagram the render pipeline into ARCHITECTURE.md`), diagram that subject and place the result in that doc. If invoked without arguments, diagram the thing you are currently documenting.

This is a **proxy skill**: it is named for the capability (`diagram`), not for a provider, so a doc or agent can ask for a diagram without knowing what is installed. The provider list below is ordered by preference and ends in a provider that needs nothing installed, so the skill always produces *something*.

This skill is both **user-invocable** and **agent-granted**:

- **User-invoked** — run `/diagram <what>` to get a diagram of that subject.
- **Agent-granted** — agents that list `diagram` in their `skills:` frontmatter use it whenever a doc they write calls for a diagram, without an explicit invocation.

## 1. Providers, in order

| Priority | Provider | Detect | Output |
|---|---|---|---|
| 1 | **archify** (external, optional) | A `SKILL.md` at `.claude/skills/archify/` or `.agents/skills/archify/` (project install), or at `~/.agents/skills/archify/` or `~/.claude/skills/archify/` (global install) | A self-contained interactive HTML file, produced by archify's own workflow, linked from the target doc |
| 2 | **Mermaid** (built-in fallback, always present) | None — nothing to detect | A fenced ` ```mermaid ` block embedded directly in the target doc |

The last row is the floor: it must never require an install, a network call, or a credential, and every provider above it is optional.

## 2. Resolve the provider

1. **Try the providers in table order and use the first whose detection passes.** For archify, check the four paths above with a plain file-exists test (`ls`/`test -f`); the first hit is the install to use.
2. **Confirm the winner actually runs.** If archify is present, run its self-check (`node <archify dir>/bin/archify.mjs doctor`) once. A non-zero exit means "present but broken" — fall through to the next provider and say so in the result.
3. **Never install a provider yourself.** Not `npx skills add`, not a clone, not a package install. Offering archify is the job of the toolkit's `setup` wizard (it is listed under the docs stack's recommended plugins); this skill only *uses* what the user has already accepted. If you fell back to Mermaid, mention the install command once in the result so the reader can opt in — and stop there.
4. **The content of the diagram is the same whichever provider wins.** Components, edges, and labels come from the source and the machine docs you actually read, never from memory — a provider changes the rendering, not the facts. Where the source does not name a component, leave it out rather than invent it.

## 3. Provider: archify

Read the detected `SKILL.md` and follow its workflow end to end — it identifies the diagram type, reads the matching schema and example, authors a JSON spec, validates it (`archify.mjs validate`), and delivers the HTML (`archify.mjs deliver`). Do not shortcut its validation step: an unvalidated spec is how a diagram ships with a dangling edge.

- **Where the HTML lands** — a docs-adjacent path the repo already uses for assets (`docs/diagrams/<slug>.html` when nothing else exists). Never drop it at the repo root.
- **How the doc refers to it** — a link plus a one-sentence caption of what the diagram shows. The HTML is not readable in a git diff or on a Markdown viewer, so the caption carries the point for anyone who cannot open the file.
- **Unattended runs** — in CI, a worktree, or a delegate run, set `ARCHIFY_UPDATE_CHECK_DISABLED=1` so archify's update check cannot stall a non-interactive session.

## 4. Provider: Mermaid (fallback)

Embed a fenced ` ```mermaid ` block in the target doc where the diagram belongs. Pick the Mermaid form from the diagram type:

| Diagram type | Mermaid form |
|---|---|
| Architecture, data flow, pipeline | `flowchart LR` (or `TB` when the flow is layered top-down), edges labelled with what moves along them |
| Workflow, request lifecycle | `flowchart TD` with decision diamonds for branches |
| API call sequence | `sequenceDiagram` |
| Lifecycle, state machine | `stateDiagram-v2` |

Keep it scannable: stable, meaningful node IDs; a subgraph per boundary (service, package, process); no more than about thirty nodes — past that, split into one overview and one diagram per boundary rather than shrinking the font. Do not lean on renderer-specific styling; the block must read as plain text too.

## 5. Name the provider in the result

Every result — the reply to the caller and, for agent-granted use, the docs-pass report — carries one line in this exact shape, so a reader knows whether a richer provider was skipped:

- `Diagram provider: archify` — followed by the HTML path.
- `Diagram provider: Mermaid (archify not detected — install with \`npx skills add tt-a1i/archify -g\` to upgrade)`.
- `Diagram provider: Mermaid (archify detected at <path> but its self-check failed)`.

The doc itself needs no provider annotation; the line belongs to the result, not the artifact.

## 6. Extending the provider list

A new provider is a new row in §1 — placed by preference, with a detection step that needs nothing more than a file or `command -v` check — and, if it is external, one `recommendedPlugins:` entry in the owning stack scoped to this skill. The Mermaid row stays last. Nothing else changes: callers keep asking for `diagram`.
