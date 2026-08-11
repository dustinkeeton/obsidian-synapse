---
name: dry
description: Find and remove genuine code duplication — repeated blocks, magic literals, copy-pasted markup/components, duplicated test setup — under disciplined judgment. Applies the rule of three, verifies sameness is semantic (not merely textual), and abstracts only where a shared seam is warranted, extracting to the project's existing shared-code convention and updating every call site. Invokable by users and agents.
user-invocable: true
argument-hint: "<file / dir / diff to scan> (omit for the working diff)"
---

# DRY — Don't Repeat Yourself

When this skill is invoked, hunt down and remove *genuine* duplication. If invoked with an argument (e.g., `/dry src/shared/`), scope the scan to that file, directory, or diff. If invoked without arguments, scan the working diff and propose a de-duplication plan before touching code.

DRY is a **judgment** skill, not a find-and-replace pass. The goal is to collapse duplication that is *actually one idea expressed twice* — not to fuse every pair of similar-looking lines into an abstraction. A premature or wrong abstraction is more expensive than the duplication it removes, so the guardrails in §2 matter as much as the detection in §1.

This skill is both **user-invocable** and **agent-granted**:

- **User-invoked** — run `/dry <path>` to scope the scan to a file, directory, or diff, or `/dry` with no argument to scan the working diff and propose a plan.
- **Agent-granted** — agents that list `dry` in their `skills:` frontmatter apply this discipline while writing or refactoring code, without an explicit invocation.

## 1. Detect

Look for duplication in these forms:

- **Repeated code blocks** — the same sequence of statements (a loop body, a guard clause, a transform) appearing in two or more places.
- **Magic values & literals** — the same constant (URL, key, limit, timeout, error string, regex) hard-coded in multiple spots.
- **Copy-pasted structure** — component / markup / config blocks duplicated with only small values changed (UI trees, schema definitions, route tables).
- **Duplicated test setup** — the same arrange / fixture / mock scaffolding repeated across test files instead of a shared factory or helper.

## 2. Judgment guardrails — apply before extracting anything

These are what separate DRY from over-abstraction. A candidate must clear all three:

- **Rule of three** — two occurrences is not yet a pattern. Do not abstract on the second copy by default; wait for a third (or a clear, near-term third). Two copies are usually cheaper left alone.
- **Semantic, not textual, sameness** — verify the copies encode the *same idea*, not merely the same characters. Two blocks that look alike today but answer to *different reasons for change* (different rules, different domains) are **incidental duplication** — leave them apart. Coupling them manufactures a false seam that fights every future edit.
- **A wrong abstraction costs more than the duplication** — a premature or ill-fitting abstraction forces every caller through the wrong shape and is painful to unwind. When you are unsure the sameness is real, prefer to leave the duplication (and note it) rather than lock in a bad seam.

If a candidate fails any guardrail, do **not** extract it — state why and move on. Declining is a valid, often correct, outcome.

## 3. Choose the abstraction level

Match the extraction to the kind of duplication and the smallest seam that fits:

- **Constant / config value** — for a repeated literal.
- **Helper function** — for a repeated block of logic.
- **Shared module** — for a cluster of related helpers used across features.
- **Component / template** — for duplicated markup or UI structure.
- **Test factory / fixture** — for repeated test setup.

Extract into the **project's existing convention for shared code** — the shared-utils directory, the constants file, the test-utils location the codebase already uses. Do **not** invent a new shared location; follow what is already there.

## 4. Workflow

1. **Detect** — find the candidate duplication (§1).
2. **Verify semantic sameness** — apply the guardrails (§2): confirm it is one idea, past the rule of three, and safe to couple. Drop candidates that fail.
3. **Extract** — introduce the abstraction at the right level (§3), in the project's shared-code convention.
4. **Update all call sites** — replace *every* occurrence with the new abstraction. Leaving one copy behind defeats the purpose and hides a live divergence.
5. **Prove behavior is unchanged** — run the full suite:
   ```bash
   npm test
   ```
   The tests must pass unchanged: a DRY refactor alters structure, never behavior.

## When called by agents

An agent granted `dry` applies these guardrails inline while writing or refactoring — collapsing real duplication as it appears and, just as importantly, *declining* to abstract incidental similarity or a mere second occurrence. Report both what was de-duplicated and what was deliberately left duplicated (and why), so a reviewer sees the judgment, not just the diff.
