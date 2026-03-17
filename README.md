# Auto Notes

AI-powered note elaboration, audio transcription, video transcription, and more for [Obsidian](https://obsidian.md).

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Obsidian](https://img.shields.io/badge/Obsidian-0.15.0%2B-7c3aed)
![License](https://img.shields.io/badge/license-MIT-green)
![Desktop Only](https://img.shields.io/badge/platform-desktop%20only-orange)

---

## Overview

Auto Notes adds AI assistance to your Obsidian vault. It detects incomplete notes and generates content proposals, transcribes audio and video files, enriches notes with tags and links, summarizes content, corrects formatting, organizes your vault directory structure, and recursively explores topics into interlinked knowledge trees.

All AI-generated content is presented as proposals that you review and accept -- nothing is changed without your approval (except Tidy, which offers one-click undo).

**Supported AI providers**: OpenAI, Anthropic, and Ollama (local).

---

## Features

### Elaboration
Detects stub notes (short content, TODO markers, empty sections) and generates content proposals using AI. Proposals appear in a sidebar where you can edit and accept them.

### Audio Transcription
Transcribes audio files using OpenAI Whisper API, Deepgram, or a local Whisper installation. Includes AI post-processing to remove filler words, add structure, and extract key points.

### Video Transcription
Downloads and transcribes YouTube and TikTok videos using yt-dlp and ffmpeg. Extracts the audio track and feeds it through the audio transcription pipeline.

### Enrichment
Analyzes note content to suggest metadata tags (from a configurable vocabulary), internal links to related notes, external references, and frontmatter fields. Uses graph-based proximity weighting to prioritize nearby vault content.

### Summarize
Summarizes URLs, transcriptions, and audio embeds found in notes. Supports bullet points, paragraph, and key-points styles. Can also create standalone summary notes from enrichment links.

### Tidy
Corrects spelling and formatting errors via AI without changing content meaning. Creates a snapshot before each change so you can undo instantly.

### Organize
Analyzes note content and suggests where each note should live in your vault directory structure. Proposes new directories when existing ones do not fit, with configurable confidence thresholds.

### Deep Dive
Recursively explores a note's topics into a tree of interlinked child notes. Uses breadth-first generation with local quality scoring to decide when to stop branching. Generated notes appear in the sidebar for review.

---

## Installation

Auto Notes is not yet published to the Obsidian Community Plugin directory. To install manually:

1. Navigate to your vault's plugin directory:
   ```
   <your-vault>/.obsidian/plugins/
   ```

2. Clone the repository:
   ```bash
   git clone https://github.com/dustinkeeton/obsidian-auto-notes.git auto-notes
   ```

3. Install dependencies and build:
   ```bash
   cd auto-notes
   npm install
   npm run build
   ```

4. Restart Obsidian, then go to **Settings > Community Plugins** and enable **Auto Notes**.

### External tools (optional)

For video transcription, you need these tools installed and available on your PATH:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) -- downloads video from YouTube, TikTok, and other platforms
- [ffmpeg](https://ffmpeg.org/) -- extracts audio from video files

Use the command **Auto Notes: Check dependencies** to verify these are available.

---

## Configuration

Open **Settings > Auto Notes** to configure the plugin. All features can be individually enabled or disabled.

### AI Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| AI Provider | OpenAI, Anthropic, or Ollama (local) | OpenAI |
| API Key | Your API key for the selected provider | -- |
| Ollama Endpoint | URL for local Ollama server (shown when Ollama selected) | `http://localhost:11434` |
| Model | AI model for the selected provider | GPT-4o |
| Temperature | Controls randomness (0 = deterministic, 1 = creative) | 0.7 |

### Elaboration

| Setting | Description | Default |
|---------|-------------|---------|
| Enable elaboration | Toggle stub note detection and proposal generation | On |
| Minimum word threshold | Notes with fewer words are considered stubs | 50 |
| Detect TODO markers | Flag notes containing TODO, TBD, FIXME, PLACEHOLDER | On |
| Detect empty sections | Flag notes with headings but no content | On |
| Excluded folders | Comma-separated folders to skip | `templates, .auto-notes` |

### Audio Transcription

| Setting | Description | Default |
|---------|-------------|---------|
| Enable audio | Toggle audio transcription | On |
| Transcription provider | Whisper API, Deepgram, or Local Whisper | Whisper API |
| Post-processing | Clean up transcriptions with AI | On |
| Remove filler words | Strip "um", "uh", etc. from transcripts | On |

### Video Transcription

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

---

## Development

### Setup

```bash
git clone https://github.com/dustinkeeton/obsidian-auto-notes.git
cd obsidian-auto-notes
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

### Project structure

The plugin is organized into 8 feature modules plus a shared utilities layer. Each module follows a consistent contract with `onload()` and `onunload()` lifecycle methods. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map, dependency graph, and system diagrams.

```
src/
  main.ts              Plugin entry point
  settings.ts          Settings types and defaults
  elaboration/         Stub detection and proposals
  audio/               Audio transcription
  video/               Video download and transcription
  transcription/       Unified transcription UI
  enrichment/          Tags, links, and references
  summarize/           Content summarization
  tidy/                Spelling and formatting
  organize/            Directory structuring
  deep-dive/           Recursive topic exploration
  shared/              AI client, utilities, validation
  views/               Unified proposal sidebar
```

### Testing

For development, symlink or copy the built plugin into your vault:

```bash
# From your vault's plugin directory:
ln -s /path/to/obsidian-auto-notes .obsidian/plugins/auto-notes
```

Then run `npm run dev` to rebuild automatically on changes. Reload Obsidian (Cmd+R / Ctrl+R) to pick up changes.

---

## License

[MIT](LICENSE) -- see the LICENSE file for details.
