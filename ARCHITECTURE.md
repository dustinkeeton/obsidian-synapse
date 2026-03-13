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

Transcribes audio files using cloud speech-to-text APIs, with optional AI post-processing. Supports two workflows: standalone file transcription and inline note transcription.

**Standalone transcription** (command: "Transcribe audio file"):
1. Select an audio file from your vault via the transcription modal (or mic ribbon icon)
2. The file is sent to your configured transcription provider (Whisper API by default, Deepgram as alternative)
3. Optionally, the raw transcript is post-processed by AI to remove filler words, add structure, and extract key points
4. The result is saved as a new note in your `Transcriptions/` folder

**Inline note transcription** (command: "Transcribe audio from current note"):
1. Open a note that contains audio embeds (e.g., `![[meeting-recording.mp3]]`)
2. Run the command -- it scans the note for audio embed syntax
3. A selection modal shows all found audio files; pick which ones to transcribe
4. Transcriptions are inserted as blockquote blocks directly below each embed in the same note
5. Already-transcribed embeds (detected by the presence of a transcription block below) are automatically skipped
6. Multiple embeds are processed in reverse line order so insertions do not shift line numbers

**Output format for inline transcription**:
```markdown
![[meeting-recording.mp3]]

> **Transcription of meeting-recording.mp3**
>
> ...transcribed text...
```

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
- **Features are independently toggleable**: Each can be enabled/disabled in settings. Disabled features don't register commands or consume resources. Note: ribbon icons currently register unconditionally (see Known Issues in STATUS.md).

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
| **AI** | Provider (OpenAI, Anthropic, Ollama), API key (password-masked), model (provider-specific dropdown), temperature |
| **Elaboration** | Detection thresholds, excluded folders/tags, scan behavior, proposal storage |
| **Audio** | Transcription provider, Whisper API key (shown only when needed), Deepgram API key, post-processing options, output folder |
| **Video** | yt-dlp/ffmpeg paths, temp folder, platform toggles, output folder |

All settings have sensible defaults. The minimum setup is providing an API key for your chosen AI/transcription provider.

### Model Selection

Models are selected via provider-specific dropdowns — not free text. Each provider has a curated list:

| Provider | Available Models |
|----------|-----------------|
| OpenAI | GPT-4o, GPT-4o Mini, o3, o3 Mini, o4 Mini |
| Anthropic | Claude Opus, Claude Sonnet, Claude Haiku |
| Ollama | Llama 3, Mistral, Code Llama, Gemma |

Anthropic models use simplified names in settings (e.g., `opus`) which are mapped to full API model IDs (e.g., `claude-opus-4-6`) at request time by `resolveModelId()` in `ai-client.ts`.

### API Key Handling

- All API key fields use password masking (`type="password"`) and disable autocomplete
- The **Whisper API key** field appears conditionally: only when the transcription provider is Whisper AND the AI provider is not OpenAI (since OpenAI users already have a valid key via the shared AI key)
- The transcriber uses fallback logic: `whisperApiKey || ai.apiKey`
- Deepgram key is validated as non-empty before making the API request

---

## Development Setup

A step-by-step guide to get Auto Notes running locally for development. No prior Obsidian plugin development experience required.

### Prerequisites

Install these before starting:

| Tool | Version | Why you need it |
|------|---------|-----------------|
| **Node.js** | 18+ | Builds the plugin (esbuild + TypeScript) |
| **npm** | Comes with Node.js | Installs dependencies |
| **Obsidian** | Desktop app, 0.15.0+ | The app the plugin runs inside |
| **yt-dlp** | Latest | Only needed for video transcription features |
| **ffmpeg** | Latest | Only needed for video transcription features |

### Step 1: Create a Development Vault

You want a separate vault for development so you don't risk your real notes.

1. Open Obsidian
2. Click "Create new vault"
3. Name it something like `dev-vault` and pick any location (e.g., `~/dev-vault`)
4. Once the vault opens, go to **Settings** (gear icon, bottom left) then **Community plugins**
5. Click "Turn on community plugins" if prompted -- this is required for third-party plugins to load

### Step 2: Clone the Repo into the Vault's Plugin Directory

Obsidian loads plugins from a specific folder inside each vault. You need to put this project there.

```sh
# Navigate to your vault's plugin directory (create it if it doesn't exist)
mkdir -p ~/dev-vault/.obsidian/plugins

# Clone the repo with the correct folder name
cd ~/dev-vault/.obsidian/plugins
git clone <repo-url> auto-notes
```

The folder name `auto-notes` must match the `id` field in `manifest.json`.

**Alternative -- symlink approach** (if you want the repo to live somewhere else):

```sh
# Keep the repo wherever you like
cd ~/dev
git clone <repo-url> obsidian-auto-notes

# Symlink it into the vault's plugin directory
mkdir -p ~/dev-vault/.obsidian/plugins
ln -s ~/dev/obsidian-auto-notes ~/dev-vault/.obsidian/plugins/auto-notes
```

### Step 3: Install Dependencies

```sh
cd ~/dev-vault/.obsidian/plugins/auto-notes   # or wherever the repo lives
npm install
```

This installs dev-only dependencies (esbuild, TypeScript, Obsidian type definitions). There are no runtime npm dependencies -- this is intentional.

### Step 4: Build the Plugin

**Watch mode (recommended for development):**

```sh
npm run dev
```

This starts esbuild in watch mode. Every time you save a `.ts` file, it rebuilds `main.js` automatically. The terminal will stay open -- leave it running while you work.

**Production build:**

```sh
npm run build
```

This runs TypeScript type checking first (`tsc -noEmit`), then builds with esbuild. Use this before committing to catch type errors.

Both commands produce `main.js` in the project root. Obsidian loads this file along with `manifest.json` when the plugin starts.

### Step 5: Enable the Plugin in Obsidian

1. Open your dev vault in Obsidian
2. Go to **Settings** (gear icon) then **Community plugins**
3. You should see "Auto Notes" in the list of installed plugins
4. Toggle it **on**

If you don't see it in the list, make sure you ran `npm run dev` (or `npm run build`) first -- Obsidian needs the `main.js` file to exist before it recognizes the plugin.

### Step 6: Reload After Changes

When esbuild rebuilds `main.js`, Obsidian does not pick up changes automatically. You need to reload.

**Option A -- Reload the window:**

- Press `Ctrl+R` (Windows/Linux) or `Cmd+R` (macOS) to reload the entire Obsidian window
- This picks up the rebuilt `main.js` immediately

**Option B -- Toggle the plugin:**

- **Settings** then **Community plugins** then toggle Auto Notes off and back on
- Useful if you only want to reload this plugin without refreshing the whole window

### Step 7: View Console Logs and Debug

Obsidian is built on Electron, so it has Chrome-style developer tools.

- **Windows/Linux**: `Ctrl+Shift+I`
- **macOS**: `Cmd+Opt+I`

This opens the DevTools panel where you can:
- See `console.log()` output in the **Console** tab
- Set breakpoints in the **Sources** tab (look for your code under `main.js`)
- Inspect network requests to AI APIs in the **Network** tab
- View errors and stack traces

Tip: Inline source maps are enabled in dev mode, so stack traces will reference your original `.ts` files rather than the bundled `main.js`.

### Development Workflow Summary

```
1. Edit TypeScript files in src/
           |
           v
2. esbuild rebuilds main.js automatically (watch mode)
           |
           v
3. Reload Obsidian (Cmd+R / Ctrl+R)
           |
           v
4. Test in Obsidian, check DevTools console for logs/errors
           |
           v
5. Repeat
```

### Troubleshooting

| Problem | Solution |
|---------|----------|
| Plugin not showing in Community plugins list | Make sure `main.js` and `manifest.json` both exist in the plugin folder. Run `npm run dev` first. |
| Changes not reflected after save | Check that `npm run dev` is still running. Reload Obsidian with `Ctrl+R` / `Cmd+R` after esbuild rebuilds. |
| TypeScript errors during `npm run build` | `npm run dev` skips type checking for speed. Run `npm run build` to see type errors. Fix them before committing. |
| "yt-dlp not found" or "ffmpeg not found" | These are only needed for video features. Install them via your package manager (`brew install yt-dlp ffmpeg` on macOS, etc.). |
| API key errors | Configure your AI provider API key in **Settings** then **Auto Notes**. Minimum setup is one API key for your chosen provider. |

### Project Structure

```
src/
  main.ts              Plugin entry point and module orchestration
  settings.ts          Settings interfaces and defaults
  settings-tab.ts      Obsidian settings UI
  elaboration/         Stub detection, proposal generation, review UI
  audio/               Transcription pipeline, inline note transcription, post-processing
    index.ts           AudioModule (orchestrator, commands, inline transcription logic)
    note-audio-modal.ts  NoteAudioModal (embed selection UI), AudioEmbed interface
    transcription-modal.ts  File-picker modal for standalone transcription
    transcriber.ts     Provider-routed transcription (Whisper, Deepgram, local)
    post-processor.ts  AI-powered transcript cleanup
  video/               URL detection, yt-dlp/ffmpeg integration
  shared/              AI client (with safeRequest wrapper), file utilities, validation, error handling
```

### Key Patterns

- **FeatureModule contract**: Each module has `constructor(plugin, getSettings)`, `onload()`, `onunload()`. Follow this pattern when adding features.
- **`getSettings()` closure**: Modules call `getSettings()` to always get fresh settings — no event subscription needed.
- **Zero runtime deps**: All API calls use `requestUrl` or `fetch`. External tools run as subprocesses. Don't add npm runtime dependencies.
- **Conditional loading**: Modules are only loaded when their `enabled` setting is true. Disabled modules don't register commands or events.
