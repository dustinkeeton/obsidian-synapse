---
last-updated: 2026-03-12
---

# Video Module

Downloads videos from YouTube/TikTok via yt-dlp, extracts audio, and delegates transcription to the Audio module.

## Public API

Exported from `index.ts`:

```ts
class VideoModule {
  constructor(plugin: Plugin, getSettings: () => AutoNotesSettings, audioModule: AudioModule)
  onload(): Promise<void>
  onunload(): void
  processUrl(url: string, options?: VideoProcessOptions): Promise<TranscriptionResult>
}

function detectPlatform(url: string): UrlDetectionResult | null
function isSupportedUrl(url: string): boolean

type Platform = 'youtube' | 'tiktok' | 'unknown'

interface UrlDetectionResult {
  platform: Platform
  videoId: string
  url: string
}

interface VideoSource {
  type: 'url' | 'file'
  platform?: Platform
  url?: string
  filePath?: string
  title?: string
  channel?: string
  duration?: number
}

interface VideoProcessOptions {
  postProcess?: boolean
  extractFrames?: boolean
  outputPath?: string
}

interface ExtractionResult {
  audioPath: string
  metadata: VideoMetadata
}

interface VideoMetadata {
  title: string
  channel?: string
  duration?: number
  uploadDate?: string
  description?: string
  platform?: string
  url?: string
}
```

## Internal Files

| File | Class/Export | Purpose |
|------|-------------|---------|
| `types.ts` | `Platform`, `UrlDetectionResult`, `VideoSource`, `VideoProcessOptions`, `ExtractionResult`, `VideoMetadata` | Type definitions |
| `url-detector.ts` | `detectPlatform`, `isSupportedUrl` | Regex-based URL platform detection |
| `url-detector.test.ts` | Tests | Vitest tests for URL detection (YouTube, TikTok, unsupported) |
| `audio-extractor.ts` | `AudioExtractor` | Runs yt-dlp and ffmpeg via `child_process.execFile` (no shell) |
| `video-modal.ts` | `VideoTranscriptionModal` | URL input modal with platform badge |
| `frame-extractor.ts` | `FrameExtractor` | Placeholder for future vision-based frame analysis |
| `index.ts` | `VideoModule` | Orchestrator, registers commands |

## Data Flow

```
1. User enters URL in VideoTranscriptionModal
   |
2. VideoModule.processUrl(url)
   |  Validates URL via sanitizeUrl() -- rejects non-HTTP, shell metacharacters
   |
3. detectPlatform(url)  -- url-detector.ts
   |  YouTube regex: youtube.com/watch, youtu.be, youtube.com/shorts
   |  TikTok regex: tiktok.com/@user/video/id, tiktok.com/t/..., vm.tiktok.com, vt.tiktok.com
   |
4. AudioExtractor.extractFromUrl(url)
   |  a. sanitizeUrl() defense-in-depth check
   |  b. getMetadata(url) -- runs yt-dlp --dump-json --no-download via execFile
   |  c. Download + extract -- runs yt-dlp -x --audio-format mp3 via execFile
   |  d. Tool paths validated via sanitizePath()
   |  e. shellEnv() appends /usr/local/bin, /opt/homebrew/bin, ~/.local/bin to PATH
   |  Returns: { audioPath, metadata }
   |
5. Read audio file from disk (Node fs.readFileSync)
   |
6. AudioModule.transcribe(audioData, fileName, { sourceName })  -- video/index.ts:L78
   |  (See audio/AGENTS.md for transcription pipeline)
   |
7. Clean up temp audio file (fs.unlinkSync)
   |
8. Format output with video metadata frontmatter
   |  Writes to output.folder/{{date}}-{{title}}.md via writeNote()
```

## External Dependencies

| Tool | Setting Key | Default | Purpose |
|------|-------------|---------|---------|
| yt-dlp | `video.ytDlpPath` | `'yt-dlp'` | Video download and metadata |
| ffmpeg | `video.ffmpegPath` | `'ffmpeg'` | Audio extraction from local files |

Check availability via command `auto-notes:check-dependencies`.

## Tests

File: `url-detector.test.ts` (26 test cases)

| Suite | Coverage |
|-------|----------|
| YouTube URLs | standard watch, short (youtu.be), Shorts, extra query params, hyphens/underscores |
| TikTok URLs | full video URL, username with dots/hyphens, /t/ short URL, vm.tiktok.com, vt.tiktok.com |
| Unsupported URLs | vimeo, generic, empty, non-URL, YouTube channel (no video) |
| isSupportedUrl | true for YouTube/TikTok, false for unsupported/empty |

Run: `npm test` or `npx vitest run src/video/url-detector.test.ts`

## Settings Keys

All under `settings.video`:

| Key | Controls |
|-----|----------|
| `enabled` | Module activation at startup |
| `ytDlpPath` | Path to yt-dlp binary |
| `ffmpegPath` | Path to ffmpeg binary |
| `tempFolder` | Temp directory for downloaded audio |
| `supportedPlatforms.youtube` | YouTube support flag (not yet enforced in code) |
| `supportedPlatforms.tiktok` | TikTok support flag (not yet enforced in code) |
| `frameExtraction.enabled` | Enable frame extraction (not implemented) |
| `frameExtraction.intervalSeconds` | Frame capture interval |
| `frameExtraction.visionModel` | Vision model for frame analysis |
| `frameExtraction.maxFrames` | Max frames to extract |
| `output.folder` | Output folder for video notes |
| `output.fileNameTemplate` | Template with `{{date}}` and `{{title}}` |
| `output.includeVideoMetadata` | Add platform/channel/duration to frontmatter |

## Security

- URLs validated via `sanitizeUrl()` before passing to external tools
- Tool paths validated via `sanitizePath()` -- rejects path traversal and shell metacharacters
- External commands run via `execFile` (argument array, no shell interpolation)
- Command timeout: 300s (5 min) for long downloads
- Max output buffer: 10MB

## Error Handling

- `processUrl`: errors propagated to modal callback, which calls `notifyError()`
- `AudioExtractor.getMetadata`: catches errors, returns minimal `{ title: 'Untitled', url }`
- `AudioExtractor.runCommand`: wraps `execFile` errors with exit code; ENOENT gives install guidance
- Temp file cleanup: ignores `unlinkSync` errors
- `FrameExtractor.extractFrames`: throws "not yet implemented"

## Unimplemented Features

- `auto-notes:transcribe-video-file` command: shows "coming soon" Notice
- `FrameExtractor`: placeholder class, throws on use
- `supportedPlatforms` settings: defined but not enforced in URL detection
