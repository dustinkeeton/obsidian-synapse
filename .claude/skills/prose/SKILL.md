---
name: prose
description: Write documentation prose a human can actually read — plain language over jargon, one idea per sentence, the conclusion first, and every paragraph scannable. Cuts throat-clearing, hedges, and abstraction that says nothing, and reads the result back as the target reader before shipping. Use when writing or editing human-facing docs, READMEs, decision logs, or any narrative a person must skim under time pressure. Invokable by users and agents.
user-invocable: true
argument-hint: "<file / doc to rewrite for clarity> (omit for the current writing task)"
---

# Prose — Clarity, Legibility, Scannability

When this skill is invoked, make the writing *land on a reader*. If invoked with an argument (e.g., `/prose ARCHITECTURE.md`), apply the standard to that file and rewrite what fails it. If invoked without arguments, apply it to the prose you are currently writing.

The reader is a busy human who did not read the source, will not read every word, and is scanning to answer one question. Prose that ignores that reader is decoration. Every rule below exists to shorten the distance between their question and its answer.

This skill is both **user-invocable** and **agent-granted**:

- **User-invoked** — run `/prose <path>` to hold an existing doc to this standard and fix what fails.
- **Agent-granted** — agents that list `prose` in their `skills:` frontmatter write to this standard by default, without an explicit invocation.

## 1. Plain language

- **Everyday words over jargon.** Prefer *use* to *utilize*, *start* to *initiate*, *build* to *facilitate the construction of*.
- **Define unavoidable terms at first use.** Domain terms and acronyms earn their place only if you spend one clause explaining them: "the render closure (every item pulled in by a selection)".
- **No jargon walls.** If three specialized terms land in one sentence, the sentence is for you, not the reader. Break it up and define as you go.
- **Say the thing.** Abstraction that could describe any project ("leverages a robust architecture to enable seamless workflows") says nothing. Cut it.

## 2. Sentences and paragraphs

- **One idea per sentence.** When a sentence needs two commas and an "and" to hold together, it is two sentences.
- **Short paragraphs — four lines or fewer.** A wall of text is skipped, not read.
- **Active voice, named actor.** "The installer prunes stale files," not "stale files are pruned." The reader needs to know *who does what*.
- **Cut the throat-clearing.** Delete openers like "It is important to note that," "In this section we will," and any first line that merely restates the heading above it.
- **No hedge stacking.** "It may possibly be somewhat slower" means nothing. Either it is slower, or you don't know — say which.

## 3. Reader-first ordering

Use the **inverted pyramid**: the conclusion, then the detail that supports it.

- **Lead with the most important fact** — the answer, the decision, the outcome. Never bury it under context the reader may not need.
- **Context comes after the payoff,** not before it. A reader who stops at the first line should still leave with the main point.
- **Order sections by what the reader asks first,** not by how the system was built. "How do I use it" almost always precedes "how it works inside."

## 4. Scannability

The test: a reader who reads **only the headings and the bolded leads** must still get the story.

- **Headings carry information.** "Renders are frozen output" beats "Notes" or "Details."
- **Bold the lead of each bullet** so the eye can pick the list apart without reading it.
- **Structure over prose for parallel content** — three or more parallel items belong in a list or a table, not a paragraph. (See the `md-maximalist` skill for choosing the form.)
- **One idea per bullet.** A bullet with a sub-clause pile-up is a paragraph in disguise.

## 5. Concrete over abstract — from a source

Specificity is this section's demand and its trap: the concrete details that make writing land are also the easiest ones to invent. Reach for them, but only from a source you actually read.

- **Numbers, names, and paths beat generalities.** "Keep `STATUS.md` under 100 lines" beats "keep it reasonably short." "`installer/lib/render.mjs`" beats "the render module." Take each one from a file you opened, not from what the name suggests it should be.
- **Show an example** wherever a rule is easier to demonstrate than to state.
- **Quantify claims — with *sourced* numbers only.** "Faster" is not a fact; "~200ms faster on a 500-file repo" is. But a specific you didn't read somewhere is fabrication wearing concreteness's clothes — it reads *more* credible than the vague claim it replaced, which is precisely what makes it worse.
- **When the source doesn't carry the fact, omit it.** A missing detail is a gap; an invented one is a defect. Never close the gap with a number that merely sounds right.

## 6. Read it back before shipping

Re-read the finished text **as the target reader** — someone who has not seen the code and has thirty seconds:

1. Does the first line answer their question, or make them hunt?
2. Can they skim headings + bold leads and still get the story?
3. Does every sentence earn its place? Delete any that does not.
4. Is there a word doing less work than a simpler word would?

## When called by agents

An agent granted `prose` writes to this standard inline — plain words, conclusion first, scannable structure — rather than producing a draft and cleaning it up afterward. When editing an existing doc, hold the surrounding paragraphs you touch to the same standard, but do not silently rewrite an owner-voiced document whose register is deliberate; flag it instead.
