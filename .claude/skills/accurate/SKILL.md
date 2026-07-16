---
name: accurate
description: Machine-legible accuracy — write claims an agent can act on without judgment, and treat documentation as another form of code. Verifies signatures against real exports, paths against the filesystem, counts against a real enumeration, and commands against the manifest that defines them; prefers omission over invention, and never launders an unverified guess as a hedge. A wrong doc is a bug. Use when writing or updating machine-readable docs, registries, API references, or any doc whose claims an agent will act on. Invokable by users and agents.
user-invocable: true
argument-hint: "<file / doc to verify against the repo> (omit for the current writing task)"
---

# Accurate — Machine-Legible Accuracy, Docs as Code

When this skill is invoked, hold every factual claim in a document to the standard you would hold a line of code to. If invoked with an argument (e.g., `/accurate AGENTS.md`), audit that file's claims against the repo and fix what has drifted. If invoked without arguments, apply the discipline to the doc you are currently writing.

**The test every claim must pass: can an agent act on this without judgment?** A human reader hedges for you — they notice a signature that looks off, sanity-check a suspicious path, ask someone. An agent does not. It executes the command you wrote, imports the export you named, trusts the count in your table. That is the standard this skill sets, and it is the reason machine-readable docs — registries, API references, contracts — are held to a stricter bar than prose written for a person.

**A wrong doc is a bug.** It is worse than a missing doc, because an agent or a human will act on it. A phantom file path, a drifted signature, a stale table row — these are defects, not cosmetic staleness, and they are fixed, not tolerated.

This skill is both **user-invocable** and **agent-granted**:

- **User-invoked** — run `/accurate <path>` to audit an existing doc's claims against the source and correct the drift.
- **Agent-granted** — agents that list `accurate` in their `skills:` frontmatter verify before they write, without an explicit invocation.

## 1. Every claim is traceable

Before a fact enters the document, you must be able to name **the file you read it from**. Not the file where it *should* live — the file where you *saw* it.

- Cite source references as `file.ts:42` (path, colon, line) so a reader can jump straight to the evidence.
- If you cannot point at the source, you do not know the fact. See §3.
- Naming conventions are not evidence. A file called `auth.ts` does not prove a function called `authenticate` exists — open it.

## 2. Verify before writing

Each kind of claim has exactly one way to check it. Do the check; don't infer.

| Claim | How to verify |
| --- | --- |
| A type or function signature | Read the actual export in the source file — not the call site, not the docstring |
| A file or directory path | `ls` / glob it |
| A count ("three payload types", "12 stacks") | Enumerate the real set and count it |
| A command or script | Read the manifest that defines it (`package.json`, `Makefile`, the CLI's command table) |
| A default value | Read the declaration, not the prose that describes it |
| A dependency edge | Read the import / manifest, not the architecture doc |
| Behavior under an edge case | Read the branch that handles it, or run it |

> [!WARNING]
> **Never extrapolate an API surface from naming conventions or symmetry.** "There is a `render()`, so there is surely an `unrender()`" is how phantom APIs get documented. If it is not in the export list, it does not exist.

## 3. Prefer omission over invention

**An absent fact beats a plausible guess.** A doc with a gap is incomplete; a doc with a confident fabrication is broken.

When you cannot verify a claim, choose one of these — in this order:

1. **Go verify it.** Read the file. This is almost always available and almost always cheap.
2. **Omit it.** Say nothing rather than something unchecked.
3. **Mark the gap explicitly** — `TODO: verify against <file>` — so the hole is visible and actionable.

**No hedging as cover.** Do not launder an unverified claim into the document by softening it: "this *should* return a `Promise`", "it *probably* reads from config", "typically the installer will…". A hedge is not verification; it is a guess in a raincoat. Verify it, omit it, or flag it as a gap.

## 4. Re-verify on update

Documents drift where they are edited. When you touch an existing doc:

- **Re-check the neighboring claims the diff touches** — the other rows of a table you added a row to, the sibling entries in a registry, the surrounding bullets in the section. Do not assume they still hold because they held when someone else wrote them.
- **Treat an unrelated wrong claim you notice as a bug you found,** not someone else's problem. Fix it or file it.
- **When source and doc disagree, the source wins** — and the doc gets corrected, never the other way around.

## 5. Workflow

1. **Enumerate the claims** the document makes (or is about to make).
2. **Verify each one against its source** using the table in §2 — reading, listing, counting, or running.
3. **Cite the source** as `file.ts:42` wherever the reader may need to check your work.
4. **Omit or flag what you could not verify** (§3). Never fill the gap with a hedge.
5. **Sweep the neighbors** the edit touches for drift (§4).

## When called by agents

An agent granted `accurate` verifies *before* writing rather than drafting from memory and checking afterward — the draft-then-check order is how invented facts survive into a commit. Report what you could not verify alongside what you wrote, so a reviewer can see the edges of your evidence rather than trusting a uniformly confident document.
