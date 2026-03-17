---
last-updated: 2026-03-17
---

# Video Module

Downloads videos from YouTube/TikTok via yt-dlp, extracts audio, delegates transcription to Audio module, optionally saves video to vault. Exposes public methods for unified transcription UI.

## Public API

Exported from `index.ts`:

```ts
class VideoModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, audioModule: AudioModule, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  transcribeUrl(url: string, parentOp?: { update: (msg: string) => void }): Promise<string>
  processUrl(url: string, options?: VideoProcessOptions, parentOp?: { update: (msg: string) => void }): Promise<TranscriptionResult & { videoVaultPath?: string }>
  transcribeUrlToActiveNote(url: string): Promise<void>
  transcribeAndInsert(noteFile: TFile, embeds: VideoUrlEmbed[]): Promise<void>
  onTranscriptionComplete: ((filePath: string) => void) | null
}

function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean
function findVideoUrls(content: string): VideoUrlEmbed[]

type Platform = 'youtube' | 'tiktok' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }
interface VideoProcessOptions { postProcess?: boolean; extractFrames?: boolean; outputPath?: string; insertMode?: boolean }
interface ExtractionResult { audioPath: string; metadata: VideoMetadata }
interface VideoMetadata { title: string; channel?: string; duration?: number; uploadDate?: string; description?: string; platform?: string; url?: string }
interface VideoUrlEmbed { url: string; platform: Platform; line: number }
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | All type interfaces | Type definitions |
| `url-detector.ts` | `detectPlatform`, `isSupportedUrl` | Regex URL platform detection |
| `url-detector.test.ts` | Tests | URL detection tests |
| `note-scanner.ts` | `findVideoUrls`, `hasTranscriptionBelow` | Scan note content for video URLs |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `audio-extractor.ts` | `AudioExtractor` | yt-dlp/ffmpeg via `execFile` (no shell) |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder (not implemented) |
| `index.ts` | `VideoModule` | Orchestrator, public transcription methods |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (in transcription/)
   |
2a. transcribeUrlToActiveNote(url) -- single URL to active note
   |  Calls processUrl(), builds callout + optional video embed, appends to active note
   |
2b. transcribeAndInsert(noteFile, embeds) -- batch from note scan
   |  Processes embeds in reverse line order, 2s delay between API calls
   |  Cancellable via NotificationManager operation handle
   |
2c. transcribeUrl(url, parentOp) -- returns transcript text only
   |  Used by SummarizeModule to auto-transcribe video URLs before summarizing
   |
3. sanitizeUrl(url) -- validates HTTP(S), rejects shell chars
   |
4. detectPlatform(url)
   |  YouTube: youtube.com/watch, youtu.be, youtube.com/shorts
   |  TikTok: tiktok.com/@user/video/id, tiktok.com/t/..., vm/vt.tiktok.com
   |
5. AudioExtractor.extractFromUrl(url)
   |  getMetadata() --> yt-dlp --dump-json --no-download
   |  Download audio --> yt-dlp -x --audio-format mp3
   |  Tool paths via sanitizePath(), env via shellEnv()
   |
6. downloadVideoToVault() [if downloadFolder configured]
   |  yt-dlp -f mp4/best, writes to vault via adapter.writeBinary
   |
7. AudioModule.transcribe(audioData, fileName)
   |
8. Result wrapped in callout block + optional video embed
```

## Note Scanning

`findVideoUrls(content)` in `note-scanner.ts`:
- Regex: `https?://[^\s)\]>]+`
- Skips blockquote lines (transcription output)
- Skips URLs with existing transcription callout below
- Returns `VideoUrlEmbed[]` with line numbers

## Commands

Only one command registered directly:
- `auto-notes:check-dependencies` -- checks yt-dlp and ffmpeg availability

Transcription commands registered in `main.ts` (unified):
- `auto-notes:transcribe-media` -> `VideoModule.transcribeUrlToActiveNote(url)`
- `auto-notes:transcribe-note-media` -> `VideoModule.transcribeAndInsert(file, embeds)`

## External Dependencies

| Tool | Setting | Default | Purpose |
|------|---------|---------|---------|
| yt-dlp | `video.ytDlpPath` | `'yt-dlp'` | Video download and metadata |
| ffmpeg | `video.ffmpegPath` | `'ffmpeg'` | Audio extraction from local files |

`shellEnv()` appends `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin` to PATH.

## Security

- URLs validated via `sanitizeUrl()` (double-validated: in VideoModule and AudioExtractor)
- Tool paths validated via `sanitizePath()`
- Commands run via `execFile` with argument arrays (no shell)
- Command timeout: 300s, max buffer: 10MB

## Unimplemented

- `FrameExtractor`: placeholder, throws on use
- `supportedPlatforms` settings: defined but not enforced
