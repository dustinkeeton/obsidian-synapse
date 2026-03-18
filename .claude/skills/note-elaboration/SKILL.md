---
name: note-elaboration
description: Designing the note elaboration system - detecting placeholder notes, proposing non-destructive additions, storing proposals separately, and AI-powered content expansion. Use when working on the note analysis and proposal features.
user-invocable: false
---

# Note Elaboration System Design

## Core Principles

1. **Non-destructive**: Never modify original notes without explicit user approval
2. **Proposal-based**: Store suggestions in separate files, not inline
3. **Smart detection**: Focus on notes that are clearly placeholders or stubs
4. **Context-aware**: Consider vault structure, linked notes, and tags when elaborating

## Placeholder Detection Heuristics

Identify notes likely to be placeholders:
- Very short notes (< N words/lines threshold, configurable)
- Notes with bullet points but no prose
- Notes with TODO/TBD/placeholder markers
- Notes with headings but empty sections
- Recently created notes with minimal content
- Notes linked from other notes but with sparse content

## Proposal Storage Strategy

```
vault/
├── notes/
│   └── my-note.md              # Original note (untouched)
└── .synapse/                 # Hidden proposals directory
    └── proposals/
        └── my-note.proposal.md # Proposed additions
```

### Proposal File Format

```markdown
---
source: notes/my-note.md
created: 2026-03-12T10:00:00Z
status: pending  # pending | accepted | rejected | partial
---

## Proposed Additions

### Section: [Original Section Name]
[Proposed content to add or expand]

### New Section: [Suggested Section]
[Suggested new content]
```

## User Interaction Flow

1. User triggers scan (manual command or on schedule)
2. Plugin identifies candidate notes
3. AI generates proposals stored in `.synapse/proposals/`
4. User reviews proposals via dedicated UI (sidebar, modal, or diff view)
5. User can accept, reject, or partially accept each proposal
6. Accepted content is merged into original note

## Configuration Options

- Target directory/subdirectory within vault
- Minimum note length threshold for "placeholder" detection
- AI model/API settings
- Auto-scan interval (or manual only)
- Proposal storage location
- Include/exclude patterns (folders, tags, frontmatter)
