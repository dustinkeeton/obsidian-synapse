# Architecture Overview

Auto Notes is an Obsidian plugin that provides three AI-powered features: note elaboration, audio transcription, and video transcription. It runs on desktop only (requires Node.js APIs for video processing).

---

## System Diagram

```
+------------------------------------------------------------------+
|                        Obsidian Desktop                          |
|                                                                  |
|  +---------------------------+                                   |
|  |       main.ts             |                                   |
|  |   AutoNotesPlugin         |                                   |
|  |   - loads settings        |                                   |
|  |   - initializes modules   |                                   |
|  |   - registers ribbons     |                                   |
|  +-----+------+------+------+                                   |
|        |      |      |                                           |
|        v      v      v                                           |
|  +-------+ +------+ +-------+                                   |
|  |Elab.  | |Audio | |Video  |                                   |
|  |Module | |Module| |Module |                                   |
|  +---+---+ +--+---+ +---+---+                                   |
|      |        |          |                                       |
|      |        |    +-----+------+                                |
|      |        |    | yt-dlp     |  (external CLI)                |
|      |        |    | ffmpeg     |  (external CLI)                |
|      |        |    +-----+------+                                |
|      |        |          |                                       |
|      |        |<---------+  (delegates transcription)            |
|      |        |                                                  |
|      v        v                                                  |
|  +------------------+                                            |
|  |  Shared Layer    |                                            |
|  |  - AIClient      |-----> OpenAI / Anthropic / Ollama APIs    |
|  |  - Validation    |  (URL, path, vault boundary, AI output)   |
|  |  - File utils    |                                            |
|  |  - Error handling |  (key redaction, retry, notifications)    |
|  +------------------+                                            |
|                                                                  |
|  +------------------+    +----------------------------+          |
|  | .auto-notes/     |    | Vault                      |          |
|  |   proposals/     |    |   Transcriptions/           |          |
|  |   temp/          |    |   Video Notes/              |          |
|  +------------------+    +----------------------------+          |
+------------------------------------------------------------------+
```

---

## Features

### Note Elaboration

Scans your vault for "stub" notes — short notes, notes with TODO markers, empty sections, or placeholder content — and generates AI-powered proposals to flesh them out.

**How it works**:
1. The detector scores each note on multiple heuristics (word count, TODO markers, empty headings, etc.) producing a 0-100 score
2. Notes above the threshold are flagged as candidates
3. The AI generates proposed additions using context from linked notes
4. Proposals are stored as JSON files in `.auto-notes/proposals/` — your original notes are never modified without your consent
5. You review proposals in a sidebar view and accept, edit, or reject each one

**Key principle**: Non-destructive. Proposals live in separate files and are only merged when you explicitly accept them. If the original note changed since the proposal was generated, you'll see a conflict warning.

### Audio Transcription

Transcribes audio files from your vault using cloud speech-to-text APIs, with optional AI post-processing to clean up the transcript.

**How it works**:
1. Select an audio file from your vault via the transcription modal (or mic ribbon icon)
2. The file is sent to your configured transcription provider (Whisper API by default, Deepgram as alternative)
3. Optionally, the raw transcript is post-processed by AI to remove filler words, add structure, and extract key points
4. The result is saved as a new note in your `Transcriptions/` folder

### Video Transcription

Downloads videos from YouTube or TikTok, extracts the audio, and transcribes it — producing a structured note with video metadata.

**How it works**:
1. Paste a video URL into the transcription modal
2. The plugin detects the platform (YouTube or TikTok) and fetches metadata via yt-dlp
3. yt-dlp downloads and extracts the audio track
4. The audio is handed off to the Audio module for transcription (same pipeline as above)
5. The result is saved as a note in `Video Notes/` with frontmatter containing title, channel, duration, and source URL

**Requires**: yt-dlp and ffmpeg installed on your system. Run `Auto Notes: Check dependencies` to verify.

---

## How Features Interact

```
Elaboration -----> Shared (AIClient, file utils)
Audio -----------> Shared (AIClient for post-processing, file utils for output)
Video --+-------> Audio (delegates transcription step)
        +-------> Shared (file utils for output)
```

- **Video depends on Audio**: This is the only cross-feature dependency. Video downloads and extracts audio, then calls `AudioModule.transcribe()` for the actual speech-to-text work. This means Audio must be initialized before Video.
- **All features use Shared**: The shared layer provides the AI client (multi-provider), file utilities (reading/writing vault notes), input validation (URL/path sanitization), output sanitization (AI response cleaning), and error handling (user notifications with API key redaction).
- **Features are independently toggleable**: Each can be enabled/disabled in settings. Disabled features don't register commands or consume resources.

---

## Security Architecture

The plugin handles user-controlled inputs (URLs, file paths) and AI-generated outputs, both of which need careful treatment.

### Input Validation (defense-in-depth)

```
User Input (URL, path)
    │
    ▼
sanitizeUrl() / sanitizePath()
    ├── Reject null bytes
    ├── Validate URL scheme (http/https only)
    ├── Reject path traversal (..)
    └── Reject shell metacharacters (; | & ` $ etc.)
    │
    ▼
execFile(cmd, [args...])         ← No shell invocation
    ├── 5-minute timeout
    └── 10MB buffer limit
```

- **URLs**: Validated via `sanitizeUrl()` before passing to yt-dlp. Only HTTP/HTTPS schemes accepted.
- **Paths**: Validated via `sanitizePath()` before passing to ffmpeg. No path traversal allowed.
- **Vault boundary**: `ensureWithinVault()` verifies resolved paths don't escape the vault directory.
- **Subprocess execution**: Uses `execFile` (not `exec`) — arguments are passed as an array, never interpolated into a shell string.

### Output Sanitization

AI-generated text is sanitized via `sanitizeAIResponse()` before being written to vault notes:
- Strips `<script>` tags and their content
- Strips HTML event handlers (`onclick`, `onerror`, etc.)
- Strips dangerous URI schemes in markdown links (`javascript:`, `data:`, `vbscript:`)
- Strips `<iframe>`, `<embed>`, and `<object>` tags

### API Key Protection

- Keys are stored in Obsidian's plugin data (not in files within the vault)
- Error messages are redacted via `notifyError()` — patterns matching API key formats are replaced with `[REDACTED]`
- Ollama endpoint validation: HTTPS required for remote endpoints (HTTP allowed for localhost only)

---

## Configuration Overview

Settings are organized into four groups accessible from the plugin's settings tab:

| Group | What it controls |
|-------|-----------------|
| **AI** | Provider (OpenAI, Anthropic, Ollama), API key, model, temperature |
| **Elaboration** | Detection thresholds, excluded folders/tags, scan behavior, proposal storage |
| **Audio** | Transcription provider, language, post-processing options, output folder |
| **Video** | yt-dlp/ffmpeg paths, temp folder, platform toggles, output folder |

All settings have sensible defaults. The minimum setup is providing an API key for your chosen AI/transcription provider.

---

## Getting Started for Contributors

### Prerequisites

- Node.js (for building)
- An Obsidian vault for testing (recommend a dedicated dev vault)
- yt-dlp and ffmpeg (for video features)

### Build and Run

```sh
# Install dev dependencies
npm install

# Development build with watch mode
npm run dev

# Production build (includes TypeScript type checking)
npm run build
```

### Project Structure

```
src/
  main.ts              Plugin entry point and module orchestration
  settings.ts          Settings interfaces and defaults
  settings-tab.ts      Obsidian settings UI
  elaboration/         Stub detection, proposal generation, review UI
  audio/               Transcription pipeline and post-processing
  video/               URL detection, yt-dlp/ffmpeg integration
  shared/              AI client, file utilities, validation, error handling
```

### Key Patterns

- **FeatureModule contract**: Each module has `constructor(plugin, getSettings)`, `onload()`, `onunload()`. Follow this pattern when adding features.
- **`getSettings()` closure**: Modules call `getSettings()` to always get fresh settings — no event subscription needed.
- **Zero runtime deps**: All API calls use `requestUrl` or `fetch`. External tools run as subprocesses. Don't add npm runtime dependencies.
- **Conditional loading**: Modules are only loaded when their `enabled` setting is true. Disabled modules don't register commands or events.
