---
name: md-maximalist
description: Use markdown's full formatting range — tables, callouts, task lists, collapsible sections, code fences, bold-lead bullets — to build tasteful richness in docs. Chooses the form from the shape of the content (parallel items become tables, sequences become ordered lists, optional depth becomes a collapsible) and holds every formatting choice to one test — does it speed up a scanning reader. Richness in service of scanning, never decoration. Use when writing or restructuring human-facing markdown. Invokable by users and agents.
user-invocable: true
argument-hint: "<file / doc to restructure> (omit for the current writing task)"
---

# Markdown Maximalist — The Full Toolbox, Used Deliberately

When this skill is invoked, use markdown's whole formatting range to make a document faster to scan. If invoked with an argument (e.g., `/md-maximalist STATUS.md`), restructure that file. If invoked without arguments, apply the standard to the markdown you are currently writing.

**Maximalist means the full toolbox is on the table — not that every tool goes in every document.** A plain paragraph is the right answer often. The discipline is *choosing the form that fits the content's shape*, and reaching past the default bullet list when the content is really a table, a sequence, or a tangent.

This skill is both **user-invocable** and **agent-granted**:

- **User-invoked** — run `/md-maximalist <path>` to restructure an existing doc's formatting.
- **Agent-granted** — agents that list `md-maximalist` in their `skills:` frontmatter reach for these forms while writing, without an explicit invocation.

## 1. The one test

> **Every formatting choice must speed up a reader who is scanning.**

If a table reads worse than a sentence, write the sentence. If a callout would say the same thing as the paragraph above it, cut it. Formatting that exists to look rich *is* decoration — the thing this skill forbids.

## 2. Choose the form from the shape of the content

| Content shape | Right form |
| --- | --- |
| 3+ parallel items with the same attributes | **Table** — one row each, attributes as columns |
| A sequence where order matters | **Ordered list** |
| Non-parallel points, one idea each | **Bullet list with bold leads** |
| Completion / progress state | **Task list** (`- [ ]` / `- [x]`) |
| A warning, caveat, or "read this first" | **Callout** (see §3) |
| Long tangent, sample output, edge-case detail | **`<details>` collapsible** |
| Code, commands, signatures, file trees | **Fenced block with a language tag** |
| A term and its definition | **Bold-lead bullet** — `- **term** — definition` |
| A hard topic break in a long doc | **Horizontal rule** (`---`) |

## 3. The toolbox

- **Tables** — for registries, comparisons, and enumerations. Keep cells short; a table crammed with paragraphs is worse than a list.
- **Callouts** — GitHub alerts when the target renders them. **The marker sits alone on its line**; put text beside it (`> [!NOTE] Useful context.`) and GitHub renders a plain blockquote with a literal `[!NOTE]` in it — the alert never fires:
  ```markdown
  > [!NOTE]
  > Useful context that is not essential.

  > [!WARNING]
  > A footgun the reader will otherwise hit.
  ```
  Plain `> **Note:** …` blockquotes are the portable fallback.
- **Task lists** — `- [x] Done` / `- [ ] Pending` for anything with completion state; they render as checkboxes and scan instantly.
- **Collapsibles** — hide length, never substance:
  ```markdown
  <details><summary>Full output of the failing run</summary>

  …

  </details>
  ```
  The `<summary>` must say what is inside, and a blank line after it is required or the markdown inside won't render.
- **Fenced code blocks** — always language-tagged (` ```ts `, ` ```bash `, ` ```yaml `) so syntax highlighting fires.
- **Bold-lead bullets** — the workhorse. `- **What it is** — what it does.` Lets the eye pick the list apart without reading it.
- **Horizontal rules** — sparingly, to separate major movements in a long document.
- **Emoji / badges** — as *anchors* only (a status column, a build badge), never as punctuation. Zero is a fine number.

## 4. Anti-patterns

- **Emphasis soup** — bold and italics everywhere. When everything is emphasized, nothing is. Bold the lead; leave the rest plain.
- **One-row tables** — a table with a single row is a sentence wearing a costume.
- **Nested-list pileups** — three levels deep means the structure is wrong. Promote the sub-list to its own section or table.
- **Collapsibles hiding must-read content** — if the reader needs it, it does not go behind a `<details>`. Collapse tangents, not the point.
- **Untagged code fences** — no language tag, no highlighting, no reason.
- **Decorative headers** — headings that carry no information ("Overview", "Notes", "More") waste the single strongest scanning signal in the document.

## 5. Workflow

1. **Read the content's shape** — is it parallel, sequential, stateful, or a tangent?
2. **Pick the form from §2** — do not default to a bullet list for everything.
3. **Apply the one test (§1)** — would a scanning reader be faster with this, or is it decoration? Revert what fails.
4. **Sweep for anti-patterns (§4)** — emphasis soup, one-row tables, deep nesting, untagged fences.

## When called by agents

An agent granted `md-maximalist` picks the fitting form while drafting, rather than writing a flat bullet list and prettifying it afterward. Match the host document's existing conventions — if a repo's docs never use collapsibles or emoji, do not introduce them unasked. Portability caveat: GitHub `> [!NOTE]` alerts and `<details>` blocks render only in HTML-aware targets, so fall back to plain blockquotes where the output may be read as raw text.
