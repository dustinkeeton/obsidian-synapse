<p align="center">
  <img src="assets/brand/banner.svg" alt="Synapse — More connections. Brighter thoughts." width="100%">
</p>

# Synapse

Automatically elaborate, transcribe, enrich, summarize, organize, and connect your notes with AI in [Obsidian](https://obsidian.md).

## Overview

Synapse is an Obsidian plugin that uses AI to help you build, maintain, and connect your knowledge base. It detects incomplete or stub notes and proposes content expansions, transcribes audio and video media into searchable text, enriches notes with tags, internal links, and references, summarizes content, corrects formatting, organizes your vault directory structure, and recursively explores topics into interlinked knowledge trees.

Every AI-generated change goes through a proposal review system. You see what the plugin wants to do, accept or reject each suggestion, and undo any change with built-in checkpoint support. Nothing is written to your vault without your approval.

**Supported AI providers**: OpenAI, Anthropic, Google Gemini, and Ollama (local).

## Features

### Elaboration
Scans your vault for stub notes (short content, TODO markers, empty sections) and generates AI-powered content proposals. Proposals appear in a sidebar where you can edit and accept them.

### Audio Transcription
Transcribes audio files embedded in your notes using OpenAI Whisper API, Deepgram, or a local Whisper installation. Includes AI post-processing to remove filler words, add structure, and extract key points.

### Video Transcription (desktop only)
Downloads and transcribes YouTube and TikTok videos using yt-dlp and ffmpeg. Extracts the audio track and feeds it through the audio transcription pipeline. Not available on mobile.

### Enrichment
Analyzes note content to suggest metadata tags (from a configurable vocabulary), internal links to related notes, topic links, and external references. Uses proximity-weighted scoring to find the most relevant connections in your vault. Runs automatically after elaboration, transcription, or summarization when configured.

### Summarize
Summarizes URLs, transcriptions, and audio embeds found in notes. Supports bullet points, paragraph, and key-points styles. Can also create standalone summary notes from enrichment links.

### Tidy
Corrects spelling and formatting errors via AI without changing content meaning. Creates a snapshot before each change so you can undo instantly.

### Organize
AI-powered semantic directory structuring. Analyzes note content and suggests where each note should live in your vault. Proposes new directories when existing ones do not fit, with configurable confidence thresholds.

### Deep Dive
Recursively explores a note's topics into a tree of interlinked child notes. Uses breadth-first generation with local quality scoring to decide when to stop branching. Configurable depth, quality threshold, and output folder structure (nested, flat, or AI-organized).

### Shared Infrastructure

- **Unified Proposal View** -- a sidebar panel where you review and accept/reject proposals from all modules in one place.
- **Checkpoint/Undo System** -- every vault-wide operation creates checkpoints so you can resume interrupted operations or roll back changes.
- **Notification Manager** -- centralized notifications with status bar integration on desktop.

## Privacy and network use

Synapse runs inside your vault. It contacts a remote service only when you configure one and then trigger a feature that needs it. Every request goes through Obsidian's `requestUrl` API, and every request is one you set up (your provider and API key) or started yourself (running a command).

Synapse ships with **no telemetry, no analytics, and no auto-update or update-check traffic of its own** -- it never contacts a server on its own, and nothing about how you use it is collected or sent anywhere. If you never set an API key and never enable a cloud provider, Synapse sends nothing out.

### Remote services

These are the only services Synapse contacts, what each one is used for, and what is sent:

| Service | Used for | What is sent | Account |
|---------|----------|--------------|---------|
| OpenAI -- `api.openai.com` | AI provider; Whisper audio transcription | The note content you act on, or the audio you transcribe | API key required |
| Anthropic -- `api.anthropic.com` | AI provider | The note content you act on | API key required |
| Google Gemini -- `generativelanguage.googleapis.com` | AI provider; audio transcription | The note content you act on, or the audio you transcribe | API key required |
| Deepgram -- `api.deepgram.com` | Audio transcription | The audio you transcribe | API key required |
| Twitter / X -- `publish.twitter.com` (fxtwitter, vxtwitter as fallbacks) | Tweet context during enrichment and summarize | The tweet URL found in your note | None |
| Web pages -- any `http(s)` URL in your notes | Article context during elaboration, enrichment, and summarize | A request to that URL, to read the page | None |
| YouTube / TikTok and others -- via `yt-dlp` (desktop) | Video transcription | The video URL you transcribe | None |

### What this means for you

- **Cloud AI and transcription require an account.** OpenAI, Anthropic, Google Gemini, and Deepgram each need an API key you supply in **Settings > Synapse**. The note content or audio you act on is sent to the one provider you selected so it can do the work, and to no one else.
- **Two paths stay offline.** Selected as your AI provider, **Ollama** sends note content only to the local endpoint you set (default `http://localhost:11434`) -- no account, no key, nothing leaving your machine. For transcription, the **local Whisper** option is designed to run entirely on-device for the same reason. Use these if you want Synapse to work without sending anything out.
- **Content you link is fetched from third-party sites.** When a note references a tweet or a web page and you run elaboration, enrichment, or summarize, Synapse requests that URL to read its content -- from Twitter/X (falling back to the fxtwitter and vxtwitter mirrors) or from the site itself. To avoid this, don't run those features on notes whose links you would rather not request, or turn the feature off in settings.
- **Video transcription downloads the video.** On desktop, video transcription invokes `yt-dlp` to download the source from YouTube, TikTok, or another platform, then extracts and transcribes the audio locally.
- **Audio and video transcription use privileged desktop access.** To work with `yt-dlp`, `ffmpeg`, and `ffprobe`, the desktop build reaches outside the vault in two ways, both gated to desktop only (mobile never runs this code):
  - **Direct filesystem access.** Synapse writes scratch files -- downloaded media, extracted audio, clipped or concatenated segments -- to your operating system's temp directory (`os.tmpdir()`), never inside your vault. These temp files are removed when the operation finishes, on both success and failure. The finished video, if you opt to keep it, is the only artifact saved into the vault (in your configured download folder).
  - **Local shell execution.** Synapse runs the external tools as child processes with `execFile` and an explicit argument array -- never a shell command string -- so there is no shell interpolation of URLs, paths, or titles. URLs and file paths are sanitized first (`sanitizeUrl` / `sanitizePath`), the subprocess inherits a narrowed environment (essentially just an augmented `PATH` plus `HOME`), and the binaries that run are exactly the `yt-dlp path` and `ffmpeg path` you set in settings.

Synapse proposes, you decide -- and that holds for the network too: nothing is requested until you ask for it.

## Installation

Synapse is not yet published to the Obsidian Community Plugin directory. To install manually:

1. Clone the repository:
   ```sh
   git clone https://github.com/dustinkeeton/obsidian-synapse.git
   cd obsidian-synapse
   ```

2. Install dependencies and build:
   ```sh
   npm install
   npm run build
   ```

3. Copy the built plugin into your vault:
   ```sh
   mkdir -p /path/to/your/vault/.obsidian/plugins/synapse
   cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/synapse/
   ```

4. Open Obsidian, go to **Settings > Community plugins**, and enable **Synapse**.

### Install via BRAT (Beta Reviewers Auto-update Tester)

If you prefer automatic updates during the beta period:

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian Community Plugin directory.
2. In BRAT settings, click **Add Beta Plugin**.
3. Enter `dustinkeeton/obsidian-synapse` and click **Add Plugin**.
4. Enable **Synapse** in **Settings > Community plugins**.

BRAT will automatically check for updates and notify you when new versions are available.

### External tools (optional)

For video transcription, you need these tools installed and available on your PATH:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) -- downloads video from YouTube, TikTok, and other platforms
- [ffmpeg](https://ffmpeg.org/) -- extracts audio from video files

Use the command **Synapse: Check dependencies** to verify these are available.

### Verifying releases

Release assets are signed with [GitHub artifact attestations](https://docs.github.com/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds), letting you cryptographically confirm they were built from this repository. After downloading a release, verify an asset with the [GitHub CLI](https://cli.github.com/):

```sh
gh attestation verify main.js --repo dustinkeeton/obsidian-synapse
```

Repeat for `manifest.json` and `styles.css` as needed.

## Configuration

Open **Settings > Synapse** to configure the plugin. All features can be individually enabled or disabled.

### AI Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| AI provider | OpenAI, Anthropic, or Ollama (local) | OpenAI |
| API key | Your API key for the selected provider | -- |
| Ollama endpoint | URL for local Ollama server (shown when Ollama selected) | `http://localhost:11434` |
| Model | AI model for the selected provider | GPT-4o |
| Temperature | Controls randomness (0 = deterministic, 1 = creative) | 0.7 |

### Elaboration

| Setting | Description | Default |
|---------|-------------|---------|
| Enable elaboration | Toggle stub note detection and proposal generation | On |
| Minimum word threshold | Notes with fewer words are considered stubs | 50 |
| Detect TODO markers | Flag notes containing TODO, TBD, FIXME, PLACEHOLDER | On |
| Detect empty sections | Flag notes with headings but no content | On |
| Excluded tags | Notes carrying these tags are skipped | `no-elaborate` |

### Audio Transcription

| Setting | Description | Default |
|---------|-------------|---------|
| Enable audio | Toggle audio transcription | On |
| Transcription provider | Whisper API, Deepgram, or Local Whisper (desktop only) | Whisper API |
| Post-processing | Clean up transcriptions with AI | On |
| Remove filler words | Strip filler words from transcripts | On |

### Video Transcription (desktop only)

| Setting | Description | Default |
|---------|-------------|---------|
| Enable video | Toggle video transcription | On |
| yt-dlp path | Path to yt-dlp binary | `yt-dlp` |
| ffmpeg path | Path to ffmpeg binary | `ffmpeg` |
| Download folder | Where to save downloaded video files | `Media` |
| Embed in note | Add an embed link to the downloaded video | On |

### Enrichment

| Setting | Description | Default |
|---------|-------------|---------|
| Enable enrichment | Toggle tag, link, and reference suggestions | On |
| Auto-enrich | Automatically enrich after elaboration or transcription | On |
| Max metadata tags | Maximum tags to suggest per note | 5 |
| Max topic links | Maximum AI-extracted topic links | 10 |
| Max internal links | Maximum related note links | 15 |
| Max external references | Maximum external URLs | 3 |
| Internal link threshold | Minimum relevance score (0-1) | 0.3 |
| Suggest new notes | Suggest links to notes that do not exist yet | On |
| Tag vocabulary | Configurable categories (Status, Type, Source) with allowed tags | 3 categories |

### Summarize

| Setting | Description | Default |
|---------|-------------|---------|
| Enable summarize | Toggle URL and transcription summarization | On |
| Summary style | Bullet points, paragraph, or key points | Bullets |
| Max content length | Maximum characters sent to AI | 4000 |
| Custom prompt | Override the default summarization prompt | -- |
| Auto-organize | Trigger organize after summarization | Off |

### Tidy

| Setting | Description | Default |
|---------|-------------|---------|
| Enable tidy | Toggle spelling and formatting correction | On |

### Organize

| Setting | Description | Default |
|---------|-------------|---------|
| Enable organize | Toggle AI-powered directory structuring | On |
| Confidence threshold | Minimum confidence to propose a new folder (0.5-1.0) | 0.9 |

### Deep Dive

| Setting | Description | Default |
|---------|-------------|---------|
| Enable deep dive | Toggle recursive topic exploration | On |
| Max depth | Maximum levels of recursion (1-5) | 3 |
| Quality threshold | Minimum quality to continue recursing (0.1-0.9) | 0.4 |
| Max notes per run | Maximum notes generated per deep dive (10-100) | 50 |
| Output folder | Where to create new notes | `Deep Dives` |
| Nesting mode | Nested, flat, or auto-organize | Nested |
| Auto-enrich on accept | Trigger enrichment when a note is accepted | On |
| Auto-organize on accept | Trigger organize when a note is accepted | Off |

### Exclusions

A single, cross-cutting list controls which vault paths Synapse may touch. Each rule names a path pattern and the features it blocks, so you can hide a folder from everything or from just a few flows. Path exclusions live here for every feature; tag exclusions (`Excluded tags`) stay per-feature.

By default, `.synapse/**` (the plugin's own data folder) and `templates/**` are excluded from **all** features — including audio/video transcription, OCR, the intake watcher, and title checks, none of which had folder exclusions before. Existing vaults are migrated automatically on upgrade: folders you had excluded from every module broaden to all features, while a folder you scoped to a single feature stays scoped to it.

| Pattern form | Matches | Example |
|--------------|---------|---------|
| `folder/**` | The folder and everything beneath it (not the folder note itself) | `Archive/**` |
| `folder/*` | Direct children only (not nested subfolders) | `Inbox/*` |
| `path/to/note.md` | One exact note | `Journal/2026-06-14.md` |
| `name` (typed by hand) | The folder and all descendants (recursive prefix) | `templates` |

Patterns are vault-relative and **case-sensitive**, and metacharacters such as `.` are matched literally (so `.synapse/**` never matches `Xsynapse/...`). Add a folder with the picker (saved in canonical `folder/**` form) or type an exact path / `folder/*` pattern directly, choosing the scope up front. Each rule shows the features it blocks as a row of chips: pick **All features**, or add individual flows from the "+ Add feature" dropdown. Remove a chip (`✕`) to narrow the rule; a rule with no chips is inactive and blocks nothing.

When a batch or vault-wide scan hits an excluded note it skips silently; an explicitly invoked single-note command refuses with a notice naming the rule that matched.

## Development

### Prerequisites
- Node.js
- npm

### Setup

```sh
git clone https://github.com/dustinkeeton/obsidian-synapse.git
cd obsidian-synapse
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start esbuild in watch mode |
| `npm run build` | Type-check and build for production |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |

### Project Structure

The plugin is organized into 8 feature modules plus a shared utilities layer. Each module follows a consistent contract with `onload()` and `onunload()` lifecycle methods.

```
src/
  main.ts              Plugin entry point and module orchestration
  settings.ts          Settings interfaces and defaults
  settings-tab.ts      Settings UI
  elaboration/         Stub note detection and proposal generation
  audio/               Audio transcription
  video/               Video download and transcription (desktop only)
  transcription/       Unified transcription UI modals
  summarize/           Note summarization
  enrichment/          Tags, links, and references
  deep-dive/           Recursive topic exploration
  organize/            Semantic directory structuring
  tidy/                Spelling and formatting cleanup
  shared/              AI client, file utils, notifications, checkpoints
  views/               Unified proposal review sidebar
```

Build output is a single `main.js` bundle produced by esbuild.

### Testing in Obsidian

For development, symlink or copy the built plugin into your vault:

```sh
# From your vault's plugin directory:
ln -s /path/to/obsidian-synapse .obsidian/plugins/synapse
```

Then run `npm run dev` to rebuild automatically on changes. Reload Obsidian (Cmd+R / Ctrl+R) to pick up changes.

## Support

Synapse is free and open source. If it has earned a place in your workflow,
you can support continued development:

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-8b5cf6?logo=github)](https://github.com/sponsors/dustinkeeton)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-5b21b6?logo=buymeacoffee&logoColor=white)](https://www.buymeacoffee.com/dustinkeeton)

## License

[AGPL-3.0](LICENSE)
