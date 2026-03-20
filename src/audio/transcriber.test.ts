import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUrl } from '../__mocks__/obsidian';
import { Transcriber, buildMultipartBody } from './transcriber';
import { SynapseSettings, DEFAULT_SETTINGS } from '../settings';

function makeSettings(overrides?: Partial<SynapseSettings>): SynapseSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

const mockRequestUrl = vi.mocked(requestUrl);

describe('buildMultipartBody', () => {
	it('produces valid multipart body with text fields and a file', () => {
		const fields = [
			{ name: 'model', value: 'whisper-1' },
			{ name: 'response_format', value: 'verbose_json' },
		];
		const fileData = new TextEncoder().encode('fake audio content').buffer as ArrayBuffer;
		const result = buildMultipartBody(fields, {
			name: 'test.mp3',
			fieldName: 'file',
			data: fileData,
		});

		expect(result.contentType).toMatch(/^multipart\/form-data; boundary=----SynapseFormBoundary/);
		expect(result.body).toBeInstanceOf(ArrayBuffer);

		// Decode the body to verify structure
		const decoded = new TextDecoder().decode(result.body);
		const boundary = result.contentType.split('boundary=')[1];

		// Verify boundary markers
		expect(decoded).toContain(`--${boundary}`);
		expect(decoded).toContain(`--${boundary}--`);

		// Verify text fields
		expect(decoded).toContain('Content-Disposition: form-data; name="model"');
		expect(decoded).toContain('whisper-1');
		expect(decoded).toContain('Content-Disposition: form-data; name="response_format"');
		expect(decoded).toContain('verbose_json');

		// Verify file field
		expect(decoded).toContain('Content-Disposition: form-data; name="file"; filename="test.mp3"');
		expect(decoded).toContain('Content-Type: application/octet-stream');
		expect(decoded).toContain('fake audio content');
	});

	it('handles empty fields array', () => {
		const fileData = new Uint8Array([0x01, 0x02]).buffer as ArrayBuffer;
		const result = buildMultipartBody([], {
			name: 'audio.wav',
			fieldName: 'file',
			data: fileData,
		});

		const decoded = new TextDecoder().decode(result.body);
		expect(decoded).toContain('Content-Disposition: form-data; name="file"; filename="audio.wav"');
		// Should only have file part and closing boundary
		expect(decoded).not.toContain('name="model"');
	});

	it('generates unique boundaries per call', () => {
		const fileData = new Uint8Array([0x00]).buffer as ArrayBuffer;
		const r1 = buildMultipartBody([], { name: 'a.mp3', fieldName: 'file', data: fileData });
		const r2 = buildMultipartBody([], { name: 'b.mp3', fieldName: 'file', data: fileData });

		const b1 = r1.contentType.split('boundary=')[1];
		const b2 = r2.contentType.split('boundary=')[1];
		expect(b1).not.toBe(b2);
	});
});

describe('Transcriber', () => {
	let settings: SynapseSettings;
	let transcriber: Transcriber;

	beforeEach(() => {
		settings = makeSettings({
			ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'sk-test-key' },
			audio: {
				...DEFAULT_SETTINGS.audio,
				whisperApiKey: 'sk-whisper-key',
				deepgramApiKey: 'dg-test-key',
			},
		});
		transcriber = new Transcriber(() => settings);
		mockRequestUrl.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('provider dispatch', () => {
		it('throws for unsupported provider', async () => {
			settings.audio.transcriptionProvider = 'unknown' as any;
			await expect(transcriber.transcribe(new ArrayBuffer(8), 'test.mp3'))
				.rejects.toThrow('Unsupported transcription provider: unknown');
		});

		it('throws for local-whisper (not yet implemented)', async () => {
			settings.audio.transcriptionProvider = 'local-whisper';
			await expect(transcriber.transcribe(new ArrayBuffer(8), 'test.mp3'))
				.rejects.toThrow('Local Whisper transcription not yet implemented');
		});
	});

	describe('Whisper API (requestUrl)', () => {
		it('throws when no API key is configured', async () => {
			settings.audio.whisperApiKey = '';
			settings.ai.apiKey = '';
			await expect(transcriber.transcribe(new ArrayBuffer(8), 'test.mp3'))
				.rejects.toThrow('No OpenAI API key configured for Whisper');
		});

		it('falls back to shared AI key when whisperApiKey is empty', async () => {
			settings.audio.whisperApiKey = '';
			settings.ai.apiKey = 'sk-shared-key';

			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: { text: 'hello', language: 'en', duration: 1.5, segments: [] },
				text: '',
				headers: {},
			});

			await transcriber.transcribe(new ArrayBuffer(8), 'test.mp3');

			const callArgs = mockRequestUrl.mock.calls[0][0] as any;
			expect(callArgs.headers.Authorization).toBe('Bearer sk-shared-key');
		});

		it('sends multipart request to Whisper API via requestUrl', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					text: 'Hello world',
					language: 'en',
					duration: 2.5,
					segments: [{ start: 0, end: 2.5, text: 'Hello world' }],
				},
				text: '',
				headers: {},
			});

			const audioData = new Uint8Array([0xff, 0xfb, 0x90]).buffer as ArrayBuffer;
			const result = await transcriber.transcribe(audioData, 'recording.mp3');

			// Verify requestUrl was called (not native fetch)
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);

			const callArgs = mockRequestUrl.mock.calls[0][0] as any;
			expect(callArgs.url).toBe('https://api.openai.com/v1/audio/transcriptions');
			expect(callArgs.method).toBe('POST');
			expect(callArgs.headers.Authorization).toBe('Bearer sk-whisper-key');
			expect(callArgs.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
			expect(callArgs.body).toBeInstanceOf(ArrayBuffer);
			expect(callArgs.throw).toBe(false);

			// Verify response mapping
			expect(result.raw).toBe('Hello world');
			expect(result.language).toBe('en');
			expect(result.duration).toBe(2.5);
			expect(result.sourceName).toBe('recording.mp3');
			expect(result.timestamps).toEqual([{ start: 0, end: 2.5, text: 'Hello world' }]);
		});

		it('includes language field when configured', async () => {
			settings.audio.language = 'fr';

			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: { text: 'Bonjour', language: 'fr', duration: 1 },
				text: '',
				headers: {},
			});

			await transcriber.transcribe(new ArrayBuffer(8), 'test.mp3');

			const callArgs = mockRequestUrl.mock.calls[0][0] as any;
			const body = new TextDecoder().decode(callArgs.body);
			expect(body).toContain('name="language"');
			expect(body).toContain('fr');
		});

		it('throws on HTTP error status', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 429,
				json: { error: { message: 'Rate limited' } },
				text: '',
				headers: {},
			});

			await expect(transcriber.transcribe(new ArrayBuffer(8), 'test.mp3'))
				.rejects.toThrow('Whisper API request failed (status 429)');
		});

		it('handles segments being absent in response', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: { text: 'No segments', language: 'en', duration: 1 },
				text: '',
				headers: {},
			});

			const result = await transcriber.transcribe(new ArrayBuffer(8), 'test.mp3');
			expect(result.timestamps).toBeUndefined();
		});
	});

	describe('Deepgram API (requestUrl)', () => {
		beforeEach(() => {
			settings.audio.transcriptionProvider = 'deepgram';
		});

		it('throws when no API key is configured', async () => {
			settings.audio.deepgramApiKey = '';
			await expect(transcriber.transcribe(new ArrayBuffer(8), 'test.mp3'))
				.rejects.toThrow('No Deepgram API key configured');
		});

		it('sends ArrayBuffer body to Deepgram via requestUrl', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					results: {
						channels: [{
							alternatives: [{ transcript: 'transcribed text' }],
							detected_language: 'en',
						}],
					},
				},
				text: '',
				headers: {},
			});

			const audioData = new Uint8Array([0x01, 0x02, 0x03]).buffer as ArrayBuffer;
			const result = await transcriber.transcribe(audioData, 'audio.wav');

			expect(mockRequestUrl).toHaveBeenCalledTimes(1);

			const callArgs = mockRequestUrl.mock.calls[0][0] as any;
			expect(callArgs.url).toContain('https://api.deepgram.com/v1/listen');
			expect(callArgs.url).toContain('punctuate=true');
			expect(callArgs.url).toContain('paragraphs=true');
			expect(callArgs.method).toBe('POST');
			expect(callArgs.headers.Authorization).toBe('Token dg-test-key');
			expect(callArgs.headers['Content-Type']).toBe('audio/*');
			expect(callArgs.body).toBe(audioData);
			expect(callArgs.throw).toBe(false);

			expect(result.raw).toBe('transcribed text');
			expect(result.language).toBe('en');
			expect(result.sourceName).toBe('audio.wav');
		});

		it('includes language parameter when configured', async () => {
			settings.audio.language = 'de';

			mockRequestUrl.mockResolvedValue({
				status: 200,
				json: {
					results: {
						channels: [{
							alternatives: [{ transcript: 'Hallo' }],
							detected_language: 'de',
						}],
					},
				},
				text: '',
				headers: {},
			});

			await transcriber.transcribe(new ArrayBuffer(8), 'test.mp3');

			const callArgs = mockRequestUrl.mock.calls[0][0] as any;
			expect(callArgs.url).toContain('language=de');
		});

		it('throws on HTTP error status', async () => {
			mockRequestUrl.mockResolvedValue({
				status: 401,
				json: { error: 'Unauthorized' },
				text: '',
				headers: {},
			});

			await expect(transcriber.transcribe(new ArrayBuffer(8), 'test.mp3'))
				.rejects.toThrow('Deepgram API request failed (status 401)');
		});
	});
});
