# Actions panel buttons run on the first click

Tracks #352. PR #353 is open with a fix; this story is the behavior that fix must satisfy.

## Problem

Buttons in the **Synapse actions** sidebar often do nothing the first time. The per-note actions (elaborate, enrich, summarize, organize, deep dive) only run on the second click. Those are most of the panel, and the panel exists to give one- or two-tap access to Synapse, especially on mobile. Right now it feels broken.

Cause: opening the sidebar takes focus away from the note. The button hands focus back and fires the command in the same instant, before Obsidian has registered the note as active again, so the command sees no note and quietly does nothing.

## User story

As a mobile or desktop user who opens the Synapse actions panel, I want every button to run on the first tap, so that the panel is a reliable shortcut instead of a guessing game.

## Acceptance criteria

- [ ] With a note open and the actions panel visible, one click or tap on any per-note action runs it. The user never has to click back into the note first.
- [ ] This holds on every click: right after opening the panel, after switching notes, and after the panel has been open for a while.
- [ ] Actions that do not need a note (vault-wide scans, Fire Synapse, settings) also run on the first click, unchanged.
- [ ] The action targets the note the user was last working in. With split panes, that is the most recently active note, never a different pane.
- [ ] When no note is active, per-note buttons stay disabled, as today. Clicking one does nothing and shows no error.
- [ ] Clicking a button does not visibly rebuild the panel: no flicker, no lost scroll position, no buttons briefly disappearing.
- [ ] The actions themselves are unchanged. Every result still lands in the proposal sidebar for review, with the same undo path as before.
- [ ] Verified by hand on desktop and on mobile (tap, not mouse).
- [ ] A regression test proves a per-note action runs on the first click. The test must fail against the old behavior.

## Open questions

- Users trained by this bug to double-tap will now trigger two runs. Should a second tap within a short window be ignored, or is queuing the second run acceptable?
- On mobile, should the panel close after a tap so the user lands back in the note?

## Out of scope

- Redesigning the panel or adding new actions.
- Changing which actions count as per-note.
- The wider consistency review (#465).
