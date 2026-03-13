---
last-updated: 2026-03-13
---

# Video Module

Downloads videos from YouTube/TikTok via yt-dlp, extracts audio, delegates transcription to Audio module, optionally saves video to vault.

## Public API

Exported from `index.ts`:

```ts
class VideoModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, audioModule: AudioModule, notifications: NotificationManager)
  onload(): Promise<void>
  onunload(): void
  processUrl(url: string, options?: VideoProcessOptions, parentOp?: { update: (msg: string) => void }): Promise<TranscriptionResult & { videoVaultPath?: string }>
  onTranscriptionComplete: ((filePath: string) => void) | null
}

function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean

type Platform = 'youtube' | 'tiktok' | 'unknown'
interface UrlDetectionResult { platform: Platform; videoId: string; url: string }
interface VideoSource { type: 'url' | 'file'; platform?: Platform; url?: string; filePath?: string; title?: string; channel?: string; duration?: number }
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
| `video-modal.ts` | `VideoTranscriptionModal` | URL input modal |
| `note-video-modal.ts` | `NoteVideoModal` | Selection modal for note URLs |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder (not implemented) |
| `index.ts` | `VideoModule` | Orchestrator, commands |

## Data Flow

```
1. User enters URL or triggers note scan
   |
2. sanitizeUrl(url) -- validates HTTP(S), rejects shell chars
   |
3. detectPlatform(url)
   |  YouTube: youtube.com/watch, youtu.be, youtube.com/shorts
   |  TikTok: tiktok.com/@user/video/id, tiktok.com/t/..., vm/vt.tiktok.com
   |
4. AudioExtractor.extractFromUrl(url)
   |  getMetadata() --> yt-dlp --dump-json --no-download
   |  Download audio --> yt-dlp -x --audio-format mp3
   |  Tool paths via sanitizePath(), env via shellEnv()
   |
5. downloadVideoToVault() [if downloadFolder configured]
   |  yt-dlp -f mp4/best, writes to vault via adapter.writeBinary
   |
6. AudioModule.transcribe(audioData, fileName)
   |
7. Insert blockquote + optional video embed in note
   |  Cancellable via NotificationManager operation handle
```

## Note Scanning

`findVideoUrls(content)` in `note-scanner.ts`:
- Regex: `https?://[^\s)\]>]+`
- Skips blockquote lines (transcription output)
- Skips URLs with existing transcription below
- Returns `VideoUrlEmbed[]` with line numbers

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

- `auto-notes:transcribe-video-file`: shows "coming soon" notice
- `FrameExtractor`: placeholder, throws on use
- `supportedPlatforms` settings: defined but not enforced
