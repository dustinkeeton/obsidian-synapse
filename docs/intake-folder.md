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
- **(b) Pick the folder in the share dialog**, where Obsidian's share UI lets you choose a destination.
- **(c) Move the note** into the intake folder after it's created; the move is detected just like a fresh note.

> Tip: Option (a) makes mobile capture truly one-tap -- Share → Obsidian, done.

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
| **Mark processed in frontmatter** | toggle | on | Stamps `synapse-processed: true` on each note after handling so it is never reprocessed. See [Idempotency](#idempotency). |
| **Move when done (optional)** | text | *(blank)* | Destination folder to move a note into after processing. Blank = leave it where it is. The folder is created if it doesn't exist, and inbound links are preserved on the move. |

---

## How Processing Works / What to Expect

When a note settles in the intake folder, Synapse asks one question first: **is this note essentially just one URL?** (the classic share-to-vault case). The answer decides the route.

### Bare-URL notes

If the note body is essentially a single URL (the URL, modulo surrounding whitespace -- not `see <url> for details`), Synapse classifies that URL:

| URL type | Examples | What Synapse does |
|----------|----------|-------------------|
| **Video / audio** | YouTube, TikTok, Spotify, Apple Podcasts, SoundCloud, podcast RSS feeds | **Not yet available.** Synapse shows a "coming soon" notice and leaves the note for you. See [Current limitation](#current-limitation-video--audio) below. |
| **Article** | Medium, Substack, Wikipedia, or any other web page | Fetches the readable article content into the note, then runs **Elaboration** on the now-fleshed-out note. |
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

## Current Limitation: Video / Audio

Routing a bare video or audio URL to real transcription is **not part of this release**. For now, a video/audio link in the intake folder produces a "coming soon" notice and the note is left in place. Full URL-to-transcription routing is tracked in **#112**.

Article links and general text/idea notes are fully supported today.

---

## Out of Scope

These were considered and intentionally left out of the intake feature:

- **iOS Shortcuts** -- no custom Shortcut is needed; use the system share sheet → Obsidian.
- **Android Intents** -- same; the built-in Obsidian share target is enough.
- **Tasker / Automate profiles** -- not required and not provided.
- **An `obsidian://synapse` URI handler** -- there is no custom URI scheme; capture is folder-based, not URL-triggered.

Mobile capture is deliberately built on Obsidian's own share-to-vault so there is nothing extra to install or maintain.
