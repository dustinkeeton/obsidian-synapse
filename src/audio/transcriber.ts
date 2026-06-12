// CSP Compliance Note:
//
// This module previously used native fetch() + FormData for Whisper API calls
// and native fetch() with raw ArrayBuffer body for Deepgram API calls. While
// native fetch works in Obsidian's desktop Electron environment (Electron does
// not strictly enforce CSP connect-src on renderer-process fetch), it fails on
// mobile platforms (iOS/Android) where Capacitor's WebView enforces stricter
// CSP and CORS policies.
//
// Obsidian's requestUrl() API routes requests through the platform's native
// HTTP layer (Electron main process on desktop, native HTTP on mobile),
// bypassing CSP entirely. This is the officially recommended approach for
// Obsidian plugins and is already used by every other HTTP-calling module in
// this codebase (ai-client.ts, content-fetcher.ts, tweet-fetcher.ts).
//
// Key challenge: requestUrl accepts body as string | ArrayBuffer, not FormData.
// The Whisper API requires multipart/form-data with a binary file field, so we
// manually construct the multipart body with a random boundary. The Deepgram
// API accepts raw ArrayBuffer directly, which requestUrl handles natively.
//
// Migration: native fetch -> requestUrl (completed in issue #88)

import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { SynapseSettings } from '../settings';
import { withRetry, classifyNetworkError, describeNetworkError, arrayBufferToBase64 } from '../shared';
import { TranscriptionResult } from './types';

/** Timeout for transcription API requests (5 minutes for large audio files). */
const TRANSCRIPTION_TIMEOUT_MS = 300_000;

/**
 * Gemini model used for audio transcription. Flash-class: fast, low-cost,
 * native audio understanding. Verified stable on
 * ai.google.dev/gemini-api/docs/models (2026-06).
 */
const GEMINI_TRANSCRIPTION_MODEL = 'gemini-3.5-flash';

/**
 * Maximum raw audio size for Gemini inline transcription. Gemini caps the
 * whole generateContent request at 20 MB, and base64 inflates audio by ~4/3,
 * so ~15 MB of raw audio is the practical ceiling. Larger files must be
 * clipped or sent to another provider (the Files API upload path is not
 * implemented — see #251). Exported for the settings UI and tests.
 */
export const GEMINI_MAX_INLINE_AUDIO_BYTES = 15 * 1024 * 1024;

/** Map an audio file extension to the MIME type Gemini expects. */
function geminiMimeType(fileName: string): string {
	const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
	const map: Record<string, string> = {
		mp3: 'audio/mp3',
		wav: 'audio/wav',
		m4a: 'audio/mp4',
		mp4: 'audio/mp4',
		ogg: 'audio/ogg',
		oga: 'audio/ogg',
		flac: 'audio/flac',
		aac: 'audio/aac',
		aiff: 'audio/aiff',
		aif: 'audio/aiff',
		webm: 'audio/webm',
	};
	return map[ext] ?? 'audio/mp3';
}

/**
 * Build a multipart/form-data body manually from field definitions.
 *
 * Obsidian's requestUrl does not support FormData, so we construct the
 * multipart body as an ArrayBuffer with a random boundary string.
 *
 * @returns An object with the Content-Type header (including boundary) and the body ArrayBuffer.
 */
export function buildMultipartBody(
	fields: { name: string; value: string }[],
	file: { name: string; fieldName: string; data: ArrayBuffer }
): { contentType: string; body: ArrayBuffer } {
	const boundary = '----SynapseFormBoundary' + Math.random().toString(36).slice(2);
	const encoder = new TextEncoder();
	const crlf = '\r\n';

	const parts: Uint8Array[] = [];

	// Add text fields
	for (const field of fields) {
		const header =
			`--${boundary}${crlf}` +
			`Content-Disposition: form-data; name="${field.name}"${crlf}${crlf}` +
			`${field.value}${crlf}`;
		parts.push(encoder.encode(header));
	}

	// Add file field
	const fileHeader =
		`--${boundary}${crlf}` +
		`Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.name}"${crlf}` +
		`Content-Type: application/octet-stream${crlf}${crlf}`;
	parts.push(encoder.encode(fileHeader));
	parts.push(new Uint8Array(file.data));
	parts.push(encoder.encode(crlf));

	// Closing boundary
	parts.push(encoder.encode(`--${boundary}--${crlf}`));

	// Concatenate all parts into a single ArrayBuffer
	const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const body = new Uint8Array(totalLength);
	let offset = 0;
	for (const part of parts) {
		body.set(part, offset);
		offset += part.byteLength;
	}

	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		body: body.buffer as ArrayBuffer,
	};
}

export class Transcriber {
	constructor(private getSettings: () => SynapseSettings) {}

	// Retry connection-level failures only — NOT the 5-min app timeout (would mean up to 15 min).
	private static readonly retryableNetwork = (e: unknown) => {
		const k = classifyNetworkError(e);
		return k === 'connection-refused' || k === 'dns' || k === 'offline';
	};

	private async requestTranscription(resource: string, params: RequestUrlParam): Promise<RequestUrlResponse> {
		const send = () => Promise.race([
			requestUrl(params),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`${resource} request timed out`)), TRANSCRIPTION_TIMEOUT_MS)),
		]);
		try {
			return await withRetry(send, 2, 1000, Transcriber.retryableNetwork); // 2 attempts, 1s→2s backoff
		} catch (error) {
			const networkMsg = describeNetworkError(error, resource);
			throw networkMsg ? new Error(networkMsg) : error;
		}
	}

	async transcribe(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings().audio;

		switch (settings.transcriptionProvider) {
			case 'whisper-api':
				return this.transcribeWhisperAPI(audioData, fileName);
			case 'deepgram':
				return this.transcribeDeepgram(audioData, fileName);
			case 'gemini':
				return this.transcribeGemini(audioData, fileName);
			case 'local-whisper':
				return this.transcribeLocalWhisper(audioData, fileName);
			default:
				throw new Error(
					`Unsupported transcription provider: ${settings.transcriptionProvider}`
				);
		}
	}

	/** Resolve the API key for Whisper: use dedicated whisperApiKey if set, otherwise fall back to shared AI key */
	private getWhisperApiKey(): string {
		const settings = this.getSettings();
		return settings.audio.whisperApiKey || settings.ai.apiKey;
	}

	private async transcribeWhisperAPI(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings();
		const apiKey = this.getWhisperApiKey();
		if (!apiKey) {
			throw new Error(
				'No OpenAI API key configured for Whisper. ' +
				'Set one in Audio Transcription settings or use OpenAI as your AI provider.'
			);
		}

		// Build multipart body manually since requestUrl does not support FormData
		const fields: { name: string; value: string }[] = [
			{ name: 'model', value: settings.audio.whisperModel },
			{ name: 'response_format', value: 'verbose_json' },
		];
		if (settings.audio.language) {
			fields.push({ name: 'language', value: settings.audio.language });
		}

		const { contentType, body } = buildMultipartBody(fields, {
			name: fileName,
			fieldName: 'file',
			data: audioData,
		});

		const response = await this.requestTranscription('the Whisper transcription API', {
			url: 'https://api.openai.com/v1/audio/transcriptions',
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
				'Content-Type': contentType,
			},
			body,
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(`Whisper API request failed (status ${response.status})`);
		}

		const data = typeof response.json === 'string'
			? JSON.parse(response.json)
			: response.json;
		return {
			raw: data.text,
			language: data.language,
			duration: data.duration,
			sourceName: fileName,
			timestamps: data.segments?.map(
				(s: { start: number; end: number; text: string }) => ({
					start: s.start,
					end: s.end,
					text: s.text,
				})
			),
		};
	}

	private async transcribeDeepgram(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings().audio;
		if (!settings.deepgramApiKey) {
			throw new Error(
				'No Deepgram API key configured. ' +
				'Set one in Audio Transcription settings.'
			);
		}
		const params = new URLSearchParams({
			punctuate: 'true',
			paragraphs: 'true',
		});
		if (settings.language) {
			params.set('language', settings.language);
		}

		const response = await this.requestTranscription('the Deepgram transcription API', {
			url: `https://api.deepgram.com/v1/listen?${params}`,
			method: 'POST',
			headers: {
				'Authorization': `Token ${settings.deepgramApiKey}`,
				'Content-Type': 'audio/*',
			},
			body: audioData,
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(`Deepgram API request failed (status ${response.status})`);
		}

		const data = typeof response.json === 'string'
			? JSON.parse(response.json)
			: response.json;
		const result = data.results.channels[0].alternatives[0];
		return {
			raw: result.transcript,
			language: data.results.channels[0].detected_language,
			sourceName: fileName,
		};
	}

	/** Resolve the API key for Gemini: use dedicated geminiApiKey if set, otherwise fall back to shared AI key */
	private getGeminiApiKey(): string {
		const settings = this.getSettings();
		return settings.audio.geminiApiKey || settings.ai.apiKey;
	}

	private async transcribeGemini(
		audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		const settings = this.getSettings();
		const apiKey = this.getGeminiApiKey();
		if (!apiKey) {
			throw new Error(
				'No Gemini API key configured. ' +
				'Set one in Audio Transcription settings or use Google Gemini as your AI provider.'
			);
		}

		// Inline audio rides in the JSON request body, which Gemini caps at 20 MB
		// total. Reject oversized files up front with a clear error instead of a
		// cryptic API failure (Files API upload is intentionally not implemented).
		if (audioData.byteLength > GEMINI_MAX_INLINE_AUDIO_BYTES) {
			const sizeMb = (audioData.byteLength / (1024 * 1024)).toFixed(1);
			const limitMb = GEMINI_MAX_INLINE_AUDIO_BYTES / (1024 * 1024);
			throw new Error(
				`Audio file is too large for Gemini inline transcription ` +
				`(${sizeMb} MB, limit ${limitMb} MB). ` +
				'Clip the audio or switch to the Whisper or Deepgram provider for large files.'
			);
		}

		let prompt =
			'Transcribe this audio recording verbatim. ' +
			'Output only the transcript text with sensible punctuation and paragraph breaks — ' +
			'no preamble, commentary, or markdown formatting.';
		if (settings.audio.language) {
			prompt += ` The audio language is "${settings.audio.language}".`;
		}

		const body = JSON.stringify({
			contents: [{
				role: 'user',
				parts: [
					{ text: prompt },
					{
						inline_data: {
							mime_type: geminiMimeType(fileName),
							data: arrayBufferToBase64(audioData),
						},
					},
				],
			}],
			// Deterministic output is preferable for transcription.
			generationConfig: { temperature: 0 },
		});

		const response = await this.requestTranscription('the Gemini transcription API', {
			url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIPTION_MODEL}:generateContent`,
			method: 'POST',
			headers: {
				'x-goog-api-key': apiKey,
				'Content-Type': 'application/json',
			},
			body,
			throw: false,
		});

		if (response.status >= 400) {
			throw new Error(`Gemini API request failed (status ${response.status})`);
		}

		const data = typeof response.json === 'string'
			? JSON.parse(response.json)
			: response.json;
		const parts: Array<{ text?: string }> = data.candidates?.[0]?.content?.parts ?? [];
		return {
			raw: parts.map(p => p.text ?? '').join('').trim(),
			language: settings.audio.language || undefined,
			sourceName: fileName,
		};
	}

	private async transcribeLocalWhisper(
		_audioData: ArrayBuffer,
		fileName: string
	): Promise<TranscriptionResult> {
		// Local whisper requires writing to temp file and running CLI
		// This will be implemented via child_process in the video module pattern
		throw new Error(
			'Local Whisper transcription not yet implemented. ' +
			'Please use whisper-api or deepgram provider.'
		);
	}
}
