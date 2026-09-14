# Architecture Decision Records

Short records of decisions that cross a locked constraint (stack, dependencies, platform boundaries) or reshape a module boundary. One file per decision, numbered in order: `NNN-<slug>.md`, starting at `001`.

Each record has three sections, one short paragraph each: **Context** (the situation and the constraint in play), **Decision** (what was chosen and how it is bounded), **Consequence** (what changes, what stays fixed, and what it costs). A record is never edited after merge; a later record supersedes it and says so.

The dated log in `DECISIONS.md` at the repo root remains the running history of all decisions. An ADR is the standalone, linkable form for the ones that gate implementation.
