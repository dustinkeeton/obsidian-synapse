---
last-updated: 2026-03-19
---

# Transcription Module

Unified transcription and OCR UI modals. Replaces the former separate modals in audio/ and video/ modules. Now also handles image OCR selection.

## Public API

Exported from `index.ts`:

```ts
class UnifiedTranscriptionModal extends Modal {
  constructor(
    app: App,
    getSettings: () => SynapseSettings,
    enabledModules: { audio: boolean; video: boolean },
    callbacks: {
      onTranscribeFile: (file: TFile) => Promise<void>;
      onTranscribeUrl: (url: string) => Promise<void>;
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
```

## File Inventory

| File | Class/Export | Purpose |
|------|-------------|---------|
| `unified-modal.ts` | `UnifiedTranscriptionModal` | File picker + URL input modal for ad-hoc transcription |
| `note-media-modal.ts` | `NoteMediaModal` | Selection modal for media found in current note |
| `index.ts` | Re-exports | Barrel file |

## UnifiedTranscriptionModal

Single modal combining audio file selection and video URL input:
- Dropdown lists all audio files in vault (filtered by `AUDIO_EXTENSIONS`)
- URL text field with platform detection badge (YouTube/TikTok)
- Post-processing status display
- Validates URL via `detectPlatform()` before allowing transcription
- File selection and URL input are mutually exclusive

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

## Dependencies

| Import | From |
|--------|------|
| `AUDIO_EXTENSIONS` | `../audio` (regex constant) |
| `AudioEmbed` | `../audio` (type) |
| `detectPlatform` | `../video` (function) |
| `VideoUrlEmbed` | `../video` (type) |
| `ImageEmbed` | `../image` (type) |

## Wiring (in main.ts)

```ts
// UnifiedTranscriptionModal
new UnifiedTranscriptionModal(app, getSettings, enabledModules, {
  onTranscribeFile: (file) => audio.transcribeFileToActiveNote(file),
  onTranscribeUrl: (url) => video.transcribeUrlToActiveNote(url),
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
