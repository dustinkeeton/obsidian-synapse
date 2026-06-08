---
last-updated: 2026-06-08
---

# Video Module

Downloads videos from YouTube/TikTok via yt-dlp, extracts audio, delegates transcription to Audio module, optionally saves video to vault. Exposes public methods for unified transcription UI.

URL platform detection now lives in `src/shared/url-detector.ts` (moved out of this module to break the old
shared⇄video cycle). Video re-exports `detectPlatform`, `isSupportedUrl`, `Platform`, and `UrlDetectionResult`
from `../shared` for back-compat; new code should import them directly from `shared`.

## Public API

Exported from `index.ts`:

```ts
class VideoModule {
  constructor(plugin: Plugin, getSettings: () => SynapseSettings, audioModule: AudioModule, notifications: NotificationManager, checkpointManager: CheckpointManager, registrar: CommandRegistrar)
  onload(): Promise<void>
  onunload(): void
  resumeFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  transcribeUrl(url: string, parentOp?: { update: (msg: string) => void }): Promise<string>
  processUrl(url: string, options?: VideoProcessOptions, parentOp?: { update: (msg: string) => void }): Promise<TranscriptionResult & { videoVaultPath?: string }>
  transcribeUrlToActiveNote(url: string, timeRange?: TimeRange): Promise<void>
  transcribeAndInsert(noteFile: TFile, embeds: VideoUrlEmbed[]): Promise<void>
  onTranscriptionComplete: ((filePath: string) => void) | null
}

// Re-exported from ../shared (canonical home is shared/url-detector.ts)
function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }

// Owned by this module
function findVideoUrls(content: string): VideoUrlEmbed[]
interface VideoProcessOptions { postProcess?: boolean; extractFrames?: boolean; outputPath?: string; insertMode?: boolean; timeRange?: TimeRange }
interface ExtractionResult { audioPath: string; metadata: VideoMetadata }
interface VideoMetadata { title: string; channel?: string; duration?: number; uploadDate?: string; description?: string; platform?: string; url?: string }
interface VideoUrlEmbed { url: string; platform: Platform; line: number }
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | All type interfaces | Type definitions |
| `note-scanner.ts` | `findVideoUrls`, `hasTranscriptionBelow` | Scan note content for video URLs |
| `note-scanner.test.ts` | Tests | Note scanner tests |
| `audio-extractor.ts` | `AudioExtractor` | yt-dlp/ffmpeg via `execFile` (no shell) |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder (not implemented) |
| `index.ts` | `VideoModule` | Orchestrator, public transcription methods |

## Data Flow

```
1. User triggers via UnifiedTranscriptionModal or NoteMediaModal (in transcription/)
   |
2a. transcribeUrlToActiveNote(url, timeRange?) -- single URL to active note
   |  Calls processUrl(url, {insertMode:true, timeRange}), clips audio if timeRange provided
   |  Builds callout with time-range label + optional video embed, appends to active note
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
4. detectPlatform(url)  [from shared/url-detector.ts]
   |  YouTube: youtube.com/watch, youtu.be, youtube.com/shorts|embed|live
   |  TikTok: tiktok.com/@user/video/id, tiktok.com/t/..., vm/vt.tiktok.com
   |  Instagram: instagram.com/reel|reels|p/CODE ; Twitter/X: (mobile.)twitter.com|x.com/.../status/id
   |  isSupportedUrl() returns true for all detected platforms EXCEPT twitter
   |
5. AudioExtractor.extractFromUrl(url)
   |  getMetadata() --> yt-dlp --dump-json --no-download
   |  Download audio --> yt-dlp -x --audio-format mp3
   |  Tool paths via sanitizePath(), env via shellEnv()
   |
5a. [if timeRange] AudioExtractor.clipAudio(audioPath, start, end)
   |  Clips extracted audio via ffmpeg -ss/-to, validates end < duration
   |  Cleans up original unclipped audio
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
- `synapse:check-dependencies` -- checks yt-dlp and ffmpeg availability

Transcription commands registered in `main.ts` (unified):
- `synapse:transcribe-media` -> `VideoModule.transcribeUrlToActiveNote(url)` (registry status: `disabled`)
- `synapse:transcribe-note-media` -> `VideoModule.transcribeAndInsert(file, embeds)` (active)

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
- The `supportedPlatforms` setting was removed from `VideoSettings`; platform support is determined by `isSupportedUrl()` in `shared/url-detector.ts`
