---
name: media-transcription
description: Audio and video transcription pipeline - transcribing media to text, auto-iterating transcriptions for clarity, fetching TikTok/YouTube videos from URLs, and video content analysis. Use when working on transcription features.
user-invocable: false
---

# Media Transcription System Design

## Audio Transcription

### Pipeline
1. User provides audio file (or records within Obsidian)
2. Audio is sent to transcription API (Whisper, Deepgram, or similar)
3. Raw transcript is returned
4. Optional: AI post-processing for clarity and structure
5. Transcript saved as note (or appended to existing note)

### Post-Processing Options
- Clean up filler words, false starts
- Add punctuation and paragraph breaks
- Restructure for readability while preserving meaning
- Extract key points / summary
- Add timestamps for reference

## Video Transcription

### Core Features
- Extract audio track from video files
- Transcribe extracted audio (same pipeline as audio)
- Support local video files

### Stretch Goal: Video Content Analysis
- Frame extraction at intervals
- Vision model analysis of key frames
- Combined transcript + visual description

## URL-Based Media Fetching

### Supported Platforms
- **YouTube**: Use yt-dlp or similar to download/extract audio
- **TikTok**: Use yt-dlp (supports TikTok) to fetch video/audio

### URL Detection Flow
1. User pastes URL into note or provides via command
2. Plugin detects supported platform URL pattern
3. Fetches media using appropriate tool (yt-dlp)
4. Extracts audio track
5. Runs transcription pipeline
6. Creates/updates note with transcript

### URL Pattern Matching
```typescript
const YOUTUBE_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/;
const TIKTOK_REGEX = /tiktok\.com\/@[\w.-]+\/video\/(\d+)/;
```

## Configuration Options
- Transcription API provider and key
- Post-processing level (raw, cleaned, structured)
- Auto-detect URLs in notes (on/off)
- Output format (inline, new note, append)
- Language settings
- yt-dlp binary path

## Technical Considerations
- yt-dlp must be installed on user's system (or bundled)
- Large files may need chunked transcription
- API rate limits and costs should be surfaced to user
- Consider offline/local transcription option (whisper.cpp)
