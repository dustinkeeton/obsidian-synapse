# Holistic UX review: make Synapse feel like one plugin

Tracks #465. This story defines what "cohesive" means as testable rules, and what the review pass must produce. The fixes it finds ship as their own issues.

## Problem

Each feature works on its own, but the whole feels stitched together. Examples that prompted this:

- The time-range picker lived in a toast that could be dismissed by accident until #464 made it a modal.
- Picking a time range silently commits to the slow download-and-extract path (captions cannot be clipped). Nothing in the modal says the two buttons differ in cost, speed, or tools needed. The user expected instant captions and got a "Downloading video" toast.
- "Transcribe this link" is reachable from the command palette, the actions panel, the in-note media picker, the intake folder, and Summarize. They have looked and behaved differently (#463).
- **Remove filler words** was on by default and silently reworded verbatim transcripts. The user found out from an opaque "Post-processing transcript" toast (fixed in #468, but the pattern remains).

## User story

As a Synapse user, I want the same action to look and behave the same wherever I start it, and to be told before Synapse does anything slow, costly, or tool-dependent, so that I can predict what a click will do.

## Acceptance criteria

**The rules.** Each is a yes/no check a reviewer can apply to any surface.

1. A decision that blocks an action gets a modal. Dismissing the modal cancels; it never picks a default.
2. Same action, same result: identical input gives identical output from every starting point (command palette, ribbon, actions panel, modal, intake folder, Summarize).
3. Slow, paid, or tool-dependent paths say so before they run. Anything that downloads a video, runs yt-dlp/ffmpeg, or sends audio to a paid provider is labeled at the button or modal, and desktop-only paths say "desktop only" on mobile instead of failing later.
4. A setting whose right value depends on the content (verbatim interview vs. voice memo) is shown at the point of use or is opt-in. It is never a silent global default.
5. One word per thing: the same verb for the same action (Transcribe, Summarize, Elaborate), the same noun for the same object (note, not file; transcript vs. transcription used consistently), sentence case everywhere.
6. Every change to a note goes through a review step and has an undo path.
7. Toasts carry status and at most a navigational action ("Open settings"). They never hold a decision.

**The pass must produce**

- [ ] An inventory at `docs/product/ux-inventory.md`: every command, ribbon icon, modal, toast, sidebar, and settings section, with each action's entry points listed side by side.
- [ ] Each surface checked against rules 1 to 7. Every violation becomes a filed issue that names the rule, the surface, and a testable fix, with a priority.
- [ ] These known cases are filed or confirmed fixed: the time-range modal labels the cost difference between **Transcribe selection** (download + extract, desktop only) and **Full file** (captions when available); URL transcription behaves identically from every entry point; the home of filler-word removal is decided (see open questions).
- [ ] A copy sweep: one list of label, button, and toast wording changes, proposed as a single PR and reviewed for brand voice.
- [ ] The review itself changes no behavior. Every fix is its own issue and PR.

## Open questions

- Does filler-word removal belong in **Tidy** rather than transcription post-processing?
- Should every "transcribe a link" surface hand off to one shared flow so parity is structural rather than tested?
- Is a settings-tab restructure (grouping by task rather than by module) in this pass or its own story?

## Out of scope

- Visual redesign or theming (#342 already landed semantic colors).
- New features.
- Implementing the fixes the review finds.
