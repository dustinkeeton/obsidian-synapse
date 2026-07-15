# Intake Folder -- Frictionless Resource Capture

**Date**: 2026-06-05
**Status**: Implemented
**Feature path**: `src/intake/`

---

## What the Intake Folder Does

The intake folder is a single watched folder in your vault (default: `Inbox`). Drop a note into it -- a shared link, a snippet of text, or a half-formed idea -- and Synapse processes it automatically, then marks it so it is never touched again.

The goal is capture without ceremony: get the thing into your vault from wherever you are (especially mobile) and let Synapse do the rest. No Shortcuts to install, no automation profiles, no custom URI scheme -- you use Obsidian's own share/create flow and Synapse watches the folder.

When a markdown note appears in the intake folder (created or modified), Synapse waits briefly (~400 ms) for it to settle, then processes it exactly once.

---

## Capturing on Mobile (iOS & Android)

Mobile capture uses **Obsidian's built-in share-to-vault** -- nothing else.

1. In any app (browser, Reddit, YouTube, a notes app...), tap the system **Share** button.
2. Choose **Obsidian** from the share sheet.
3. Obsidian creates a note from the shared URL or text.
4. Make sure that note lands in your **intake folder** (see below).

Synapse picks it up and processes it automatically.

### Getting the shared note into the intake folder

The shared note only gets processed if it ends up *inside* the intake folder. Use whichever of these fits your setup:

- **(a) Set a default location.** In Obsidian: **Settings → Files & Links → Default location for new notes** → point it at your intake folder (e.g. `Inbox`). Every new/shared note then lands there automatically -- the smoothest option.
- **(b) Turn on "Adopt shared captures"** (Settings → Synapse → Intake folder). Synapse then also watches newly created notes at the vault *root* -- where shares land when your default new-note location is the vault root -- and moves any note that is just a single video/audio/article link into the intake folder for you. Off by default because it relocates root notes.
- **(c) Pick the folder in the share dialog**, where Obsidian's share UI lets you choose a destination.
- **(d) Move the note** into the intake folder after it's created; the move is detected just like a fresh note.

> Tip: Option (a) makes mobile capture truly one-tap -- Share → Obsidian, done. Option (b) is for when you want new notes to keep landing somewhere else by default.

### Sharing a video (YouTube, TikTok...)

Share a video link into the intake folder and Synapse transcribes it:

- **YouTube** links are transcribed from the video's captions -- free, fast, and it works **on mobile** too.
- **TikTok / Instagram / caption-less YouTube** need the desktop app (yt-dlp + ffmpeg). Captured on your phone in a synced vault? No problem: the note stays un-stamped in the intake folder, and your desktop vault's watcher picks it up and finishes the transcription next time it sees the note change.

---

## Capturing on Desktop

On desktop, anything that puts a markdown note into the intake folder works:

- **Drag** a link or an existing note into the intake folder in the file explorer.
- **Create a new note** directly in the intake folder and paste a URL or some text into it.

Synapse processes it the same way it processes mobile captures.

---

## Configuration

All settings live under **Settings → Synapse → Intake Folder** (see issue #113). The default intake folder is `Inbox`; change it via the **Intake folder** setting.

| Setting | Type | Default | What it does |
|---------|------|---------|--------------|
| **Enable intake processing** | toggle | on | Master switch. When off, the folder is not watched and nothing is auto-processed. |
| **Intake folder** | text | `Inbox` | The folder Synapse watches. Notes here (and in its subfolders) are processed; everything else is ignored. Leaving it blank watches *nothing* -- Synapse never falls back to scanning the whole vault. |
| **Adopt shared captures** | toggle | off | Also watch newly *created* notes at the vault root and move any whose body is a single video/audio/article link into the intake folder (#455). Catches mobile share-sheet captures when the default new-note location isn't the intake folder. |
| **Mark processed in frontmatter** | toggle | on | Stamps `synapse-processed: true` on each note after handling so it is never reprocessed. See [Idempotency](#idempotency). |
| **Move when done (optional)** | text | *(blank)* | Destination folder to move a note into after processing. Blank = leave it where it is. The folder is created if it doesn't exist, and inbound links are preserved on the move. |

---

## How Processing Works / What to Expect

When a note settles in the intake folder, Synapse asks one question first: **is this note essentially just one URL?** (the classic share-to-vault case). The answer decides the route.

### Bare-URL notes

If the note body is essentially a single URL (the URL, modulo surrounding whitespace -- not `see <url> for details`), Synapse classifies that URL:

| URL type | Examples | What Synapse does |
|----------|----------|-------------------|
| **Video** | YouTube, TikTok, Instagram | Transcribes the video and appends the transcript, then runs the full pipeline on the note. YouTube goes caption-first (all platforms, including mobile); TikTok/Instagram and caption-less videos use the desktop yt-dlp pipeline. See [Video / audio URLs](#video--audio-urls) below. |
| **Audio** | Spotify, Apple Podcasts, SoundCloud | **Not yet supported** -- the note is left un-stamped with an error notice. |
| **Article** | Medium, Substack, Wikipedia, or any other web page | Fetches the readable article content into the note, then runs the full pipeline on the now-fleshed-out note. |
| **Unrecognized URL** | anything `sanitizeUrl` can't accept (e.g. some parenthesized Wikipedia titles) | Treated as general content (below). |

### Everything else

If the note is *not* a bare URL -- shared text, a rough idea, a placeholder, prose, or multiple links -- Synapse runs the **full pipeline** on that single note:

```
Elaboration -> Summarize -> Enrichment -> REM -> Tidy -> Organize
```

Each stage only runs if that feature is **enabled in its own settings**. If you've turned a feature off, intake skips it -- intake does not override your feature toggles.

### Idempotency

Once a note is handled, Synapse stamps its frontmatter so it is **never reprocessed**:

```yaml
---
synapse-processed: true
synapse-processed-at: 2026-06-05T17:42:10.000Z
---
```

This means edits, re-syncs, or the move itself won't trigger a second pass. The stamp is controlled by the **Mark processed in frontmatter** setting (on by default); if you turn it off, you take on responsibility for not re-triggering processing yourself. If processing *fails*, the note is left **un-stamped** on purpose so it can be retried.

---

## Video / Audio URLs

A bare **video URL** in the intake folder is transcribed through tiered routing (#112/#184):

1. **YouTube captions** (all platforms, including mobile) -- the video's caption track is fetched over HTTP, cleaned, and post-processed. Free and near-instant. Controlled by the **Prefer YouTube captions** toggle in the Video transcription settings.
2. **Local extraction** (desktop only) -- the existing yt-dlp + ffmpeg pipeline downloads the video and transcribes its audio. Covers TikTok, Instagram, and YouTube videos without captions.

When neither tier applies -- e.g. a TikTok link captured **on mobile** -- the note gets an error notice and stays **un-stamped** in the intake folder. In a synced vault this is a feature: the desktop app's intake watcher retries the note when the vault syncs, so phone-captured TikToks are transcribed by your desktop. A future self-hosted extractor service (#181) will close this gap for mobile-only setups.

Bare **audio URLs** (Spotify, podcasts) are not transcribable yet -- no tier handles them, so they behave like the mobile-TikTok case above.

---

## Out of Scope

These were considered and intentionally left out of the intake feature:

- **iOS Shortcuts** -- no custom Shortcut is needed; use the system share sheet → Obsidian.
- **Android Intents** -- same; the built-in Obsidian share target is enough.
- **Tasker / Automate profiles** -- not required and not provided.
- **An `obsidian://synapse` URI handler** -- there is no custom URI scheme; capture is folder-based, not URL-triggered.

Mobile capture is deliberately built on Obsidian's own share-to-vault so there is nothing extra to install or maintain.
