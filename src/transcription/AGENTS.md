---
last-updated: 2026-03-19
---

# Transcription Module

Unified transcription and OCR UI modals with duration-aware time-range clipping. Replaces the former separate modals in audio/ and video/ modules. Also handles image OCR selection.

## Public API

Exported from `index.ts`:

```ts
class UnifiedTranscriptionModal extends Modal {
  constructor(
    app: App,
    getSettings: () => SynapseSettings,
    enabledModules: { audio: boolean; video: boolean },
    callbacks: {
      onTranscribeFile: (file: TFile, timeRange?: TimeRange) => Promise<void>;
      onTranscribeUrl: (url: string, timeRange?: TimeRange) => Promise<void>;
    }
  )
}

class NoteMediaModal extends Modal {
  constructor(
    app: App,
    audioEmbeds: AudioEmbed[],
    videoEmbeds: VideoUrlEmbed[],
    imageEmbeds: ImageEmbed[],
    callbacks: {
      onTranscribeAudio: (embeds: AudioEmbed[]) => Promise<void>;
      onTranscribeVideo: (embeds: VideoUrlEmbed[]) => Promise<void>;
      onExtractImages: (embeds: ImageEmbed[]) => Promise<void>;
    }
  )
}

class TimeRangeSlider {
  readonly containerEl: HTMLElement
  get start(): number
  get end(): number
  constructor(parentEl: HTMLElement, options: TimeRangeSliderOptions)
}

interface TimeRangeSliderOptions {
  duration: number
  initialStart?: number
  initialEnd?: number
  onChange?: (start: number, end: number) => void
}

function showTimeRangeToast(options: TimeRangeToastOptions): Promise<TimeRange | undefined>

interface TimeRangeToastOptions {
  title: string
  duration: number
}

function detectLocalFileDuration(file: TFile, readBinary: (file: TFile) => Promise<ArrayBuffer>, getSettings: () => SynapseSettings): Promise<DurationResult>
function detectUrlDuration(url: string, getSettings: () => SynapseSettings): Promise<DurationResult>
function formatTimestamp(totalSeconds: number): string

const MIN_SLIDER_DURATION: number  // 10 seconds

interface DurationResult {
  durationSeconds: number | undefined
  title: string
}
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-modal.ts` | `UnifiedTranscriptionModal` | File picker + URL input modal with duration detection and time-range slider |
| `note-media-modal.ts` | `NoteMediaModal` | Selection modal for media found in current note |
| `time-range-slider.ts` | `TimeRangeSlider`, `TimeRangeSliderOptions` | Dual-handle range slider for time selection (pure DOM component) |
| `time-range-toast.ts` | `showTimeRangeToast`, `TimeRangeToastOptions` | Confirmation toast with embedded time-range slider |
| `duration-detector.ts` | `detectLocalFileDuration`, `detectUrlDuration`, `formatTimestamp`, `MIN_SLIDER_DURATION`, `DurationResult` | Duration detection via ffprobe (local) and yt-dlp (URL) |
| `duration-detector.test.ts` | Tests | Duration detector tests |
| `index.ts` | Re-exports | Barrel file |

## UnifiedTranscriptionModal

Single modal combining audio file selection and video URL input:
- Dropdown lists all audio files in vault (filtered by `AUDIO_EXTENSIONS`)
- URL text field with platform detection badge (YouTube/TikTok/Instagram)
- Post-processing status display
- Duration detection: auto-detects media length when file selected or URL entered
- Time-range slider: shown when duration >= `MIN_SLIDER_DURATION` (10s)
- Validates URL via `detectPlatform()` before allowing transcription
- File selection and URL input are mutually exclusive
- Callbacks pass `timeRange` when user selects a sub-range

Opened via:
- Ribbon icon (`mic`)
- Command `synapse:transcribe-media`

## NoteMediaModal

Selection modal for media embedded in the current note:
- Displays count of audio files, video URLs, and images found
- Toggle checkboxes for each audio embed, video URL, and image embed
- Select All / Select None buttons
- Process Selected button dispatches to separate audio/video/image callbacks

Opened via:
- Command `synapse:transcribe-note-media`

## Duration Detection

`duration-detector.ts` provides two detection strategies:

### Local Files (`detectLocalFileDuration`)
1. Writes audio binary to temp file
2. Runs ffprobe (derived from `video.ffmpegPath` setting)
3. Parses `-show_entries format=duration` output
4. Returns `DurationResult` (undefined duration on failure/mobile)

### URLs (`detectUrlDuration`)
1. Runs `yt-dlp --dump-json --no-download` on validated URL
2. Parses `duration` and `title` from JSON metadata
3. Returns `DurationResult` (undefined duration on failure/mobile)

Both use `shellEnv()` to append common tool paths (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`).

## Time-Range Slider

`TimeRangeSlider` is a pure DOM component (no Obsidian dependencies beyond `createEl`):
- Two overlapping HTML range inputs on a shared track
- Visual highlight for the selected region
- Timestamp labels update live (MM:SS or HH:MM:SS)
- Step size: 1s for media <= 10min, 5s otherwise
- Handles cannot cross each other (enforced via input handlers)

## Time-Range Toast

`showTimeRangeToast()` shows a non-dismissible Obsidian Notice with:
- Media title
- Embedded `TimeRangeSlider`
- "Transcribe Selection" button (returns `TimeRange` if range adjusted)
- "Full File" button (returns `undefined`)

## Dependencies

| Import | From |
|--------|------|
| `AUDIO_EXTENSIONS` | `../audio` (regex constant) |
| `AudioEmbed` | `../audio` (type) |
| `detectPlatform` | `../video` (function) |
| `VideoUrlEmbed` | `../video` (type) |
| `ImageEmbed` | `../image` (type) |
| `TimeRange` | `../shared` (type) |
| `sanitizePath`, `sanitizeUrl` | `../shared` (validation) |
| `SynapseSettings` | `../settings` |

## Wiring (in main.ts)

```ts
// UnifiedTranscriptionModal
new UnifiedTranscriptionModal(app, getSettings, enabledModules, {
  onTranscribeFile: (file, timeRange) => audio.transcribeFileToActiveNote(file, timeRange),
  onTranscribeUrl: (url, timeRange) => video.transcribeUrlToActiveNote(url, timeRange),
})

// NoteMediaModal (after scanning note content)
new NoteMediaModal(app, audioEmbeds, videoEmbeds, imageEmbeds, {
  onTranscribeAudio: (selected) => audio.transcribeAndInsert(file, selected),
  onTranscribeVideo: (selected) => video.transcribeAndInsert(file, selected),
  onExtractImages: (selected) => image.extractAndInsert(file, selected),
})
```

## Migration Notes

This module was created in issue #20 (unified transcription). Replaces:
- `src/audio/transcription-modal.ts` (deleted)
- `src/audio/note-audio-modal.ts` (deleted)
- `src/video/video-modal.ts` (deleted)
- `src/video/note-video-modal.ts` (deleted)
