# Summarize media links from a real transcript, and remember the transcript

Tracks #488.

## Problem

Summarize can insert a summary callout that only says the video "would need a transcript". That happens when the transcript fetch fails (no captions, yt-dlp/ffmpeg missing, no path on mobile): Synapse quietly falls back to reading the page HTML and summarizes that. The result looks like a finished summary but is not one.

Summarize also throws the transcript away. Running **Transcribe media** on the same link afterwards fetches captions or downloads and transcribes the video all over again, including any paid transcription. Today the only reuse is a check for a transcription callout within five lines under the link.

This bites anyone who drops video links into notes and summarizes them, and it wastes money on the paid path.

## User story

As a vault owner who summarizes notes containing video links, I want Summarize to use the video's real transcript (or tell me plainly when it cannot) and to remember transcripts it already fetched, so that I never get a fake summary and never pay twice for the same video.

## Acceptance criteria

**Summarize uses the transcript**

- [ ] Summarizing a note with a supported media link (YouTube, TikTok, Instagram) produces a summary of the spoken content. No transcript text is added to the note.
- [ ] The summary is inserted exactly as today (same callout, same review step, same undo via checkpoint).
- [ ] If every transcription path fails for a link, no summary callout is inserted for that link. The user sees the existing actionable notice (for example the "Open settings" flow for missing yt-dlp/ffmpeg).
- [ ] A failed link does not block the other links in the same note.
- [ ] Non-media links keep today's page-fetch behavior. Nothing changes for articles, tweets, or Reddit posts.
- [ ] On mobile, a caption-less video fails cleanly with the same notice. The download path stays desktop-only.

**Transcripts are saved and reused**

- [ ] Every successful transcription, from any starting point (Summarize, Transcribe media, the in-note media picker, the intake folder), saves the transcript outside the note body. Nothing new is written into the note as a side effect.
- [ ] A saved transcript is keyed by the canonical link plus the time range and the path used (captions vs. download). A full-video transcript satisfies a full-video request; a clipped range does not satisfy a full request, and vice versa.
- [ ] Different spellings of the same link (`youtu.be`, `&t=`, share links) hit the same saved transcript.
- [ ] After Summarize, running **Transcribe media** on the same link inserts the saved transcript without fetching captions, downloading, or calling the transcription provider. The toast says it came from a saved transcript.
- [ ] After **Transcribe media**, Summarize reuses the saved transcript even if the transcription callout is far from the link or has been deleted from the note.
- [ ] Reusing a saved transcript makes no network request.
- [ ] The user can force a fresh fetch for a link (see open questions for where that lives).
- [ ] **Settings → Synapse → Transcription** shows how many transcripts are saved and how much space they take, with a **Clear saved transcripts** button. Clearing never touches a note.
- [ ] Saved transcripts have a size cap; the oldest entries are dropped first when it is reached.

**Privacy**

- [ ] Saved transcripts are stored in the plugin's own folder inside the vault, never in the OS temp folder, and are never uploaded anywhere. The only content sent to an AI provider is what Summarize already sends today.

## Open questions

- Where does "fetch again" live: a checkbox in the Transcribe modal ("Ignore saved transcript"), a separate command, or both?
- Should the transcript store sync with the vault (a phone benefits from transcripts a desktop made) or stay device-local (avoids sync churn from large files)?
- Default size cap. 20 MB?
- Should Elaborate read saved transcripts too, when a stub note contains a video link?

## Out of scope

- A self-hosted extraction tier for non-YouTube links on mobile (#181).
- Caching page content for non-media links.
- Changing summary styles or prompts.
- Storing transcripts in note frontmatter.
