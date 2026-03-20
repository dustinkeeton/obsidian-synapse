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

import { requestUrl } from 'obsidian';
import { SynapseSettings } from '../settings';
import { TranscriptionResult } from './types';

/** Timeout for transcription API requests (5 minutes for large audio files). */
const TRANSCRIPTION_TIMEOUT_MS = 300_000;

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

		const timeout = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('Whisper API request timed out')), TRANSCRIPTION_TIMEOUT_MS)
		);

		const response = await Promise.race([
			requestUrl({
				url: 'https://api.openai.com/v1/audio/transcriptions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': contentType,
				},
				body,
				throw: false,
			}),
			timeout,
		]);

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

		const timeout = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error('Deepgram API request timed out')), TRANSCRIPTION_TIMEOUT_MS)
		);

		const response = await Promise.race([
			requestUrl({
				url: `https://api.deepgram.com/v1/listen?${params}`,
				method: 'POST',
				headers: {
					'Authorization': `Token ${settings.deepgramApiKey}`,
					'Content-Type': 'audio/*',
				},
				body: audioData,
				throw: false,
			}),
			timeout,
		]);

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
