# Post-process long transcripts in sections

Tracks #467.

## Problem

Transcript post-processing (**Remove filler words**, add structure, extract key points, custom instructions) is skipped whenever the transcript is longer than the **Max tokens** setting. That guard (#468) is deliberate: past the limit the model silently cuts the text off, and a complete raw transcript beats a clean truncated one.

The cost is that the transcripts that most need cleanup, long unpunctuated caption dumps from lectures and interviews, get none. The user sees raw text and only a console warning explains why.

## User story

As someone who transcribes long videos and recordings, I want post-processing to run on long transcripts too, so that I get the same cleanup regardless of length without having to raise Max tokens.

## Acceptance criteria

**Splitting and joining**

- [ ] A transcript over the budget is split into sections at paragraph boundaries, falling back to sentence boundaries, so each section fits within Max tokens with headroom for the response.
- [ ] Sections are rejoined in order. A small overlap gives the model context, but the output contains no repeated text at the seams.
- [ ] Timestamps, speaker labels, and chapter headings in the raw transcript survive. A section boundary never splits a speaker line or a heading.
- [ ] A transcript that already fits is processed in one call, exactly as today.
- [ ] Key points, when enabled, appear once at the end of the transcript, not once per section.
- [ ] The custom instructions setting applies to every section.

**Running**

- [ ] Sections run one at a time, with the same pause between AI calls Synapse already uses for rate limits.
- [ ] The operation toast shows progress: "Post-processing 3/12".
- [ ] If a section fails (error, timeout, empty reply, or a reply that hit the token limit), its raw text is kept in place and the remaining sections still run. One notice at the end says how many sections were kept raw. No per-section notices.
- [ ] Works for every transcript source: audio embeds, YouTube captions, downloaded video, and the intake folder. Works on mobile; nothing here is desktop-only.
- [ ] The result is inserted exactly as today, with the same undo path.
- [ ] The "skipping post-processing" warning goes away, since nothing is skipped any more.

**Privacy and cost**

- [ ] Nothing new leaves the vault. The content sent to the AI provider is the transcript plus the overlap, to the provider the user already chose. It is sent in more requests, not to more places.

## Open questions

- How should key points be produced for a long transcript: a second pass over the cleaned text, or merging per-section lists?
- Should the toast estimate the number of AI calls before starting ("about 12 calls"), in line with the announce-before-you-run rule in the UX review (#465)?
- Can the user cancel mid-way, and if so, is the partial result inserted or discarded?
- Target section size: a fixed share of Max tokens (60%?) or a fixed token count?

## Out of scope

- Raising the default Max tokens.
- Processing sections in parallel.
- Sectioning for other modules (Summarize, Elaborate, Tidy).
- Streaming responses.
