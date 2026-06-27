import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageExtractor } from './extractor';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

const mockChat = vi.fn().mockResolvedValue('Extracted text from image');

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		chat = mockChat;
	},
}));

function makeSettings(overrides?: Partial<SynapseSettings>): SynapseSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

function makeImageBuffer(): ArrayBuffer {
	// Minimal fake image data
	const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	return data.buffer;
}

describe('ImageExtractor', () => {
	let extractor: ImageExtractor;
	let settings: SynapseSettings;

	beforeEach(() => {
		mockChat.mockClear();
		mockChat.mockResolvedValue('Extracted text from image');
		settings = makeSettings();
		extractor = new ImageExtractor(() => settings, { info: vi.fn() } as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('sends correct content blocks to AIClient', async () => {
		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'screenshot.png');

		expect(mockChat).toHaveBeenCalledOnce();
		const messages = mockChat.mock.calls[0][0];

		// Should have system and user messages
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('OCR assistant');

		// User message should have ContentBlock[] with image and text blocks
		expect(messages[1].role).toBe('user');
		const content = messages[1].content;
		expect(Array.isArray(content)).toBe(true);
		expect(content).toHaveLength(2);
		expect(content[0].type).toBe('image');
		expect(content[0].mediaType).toBe('image/png');
		expect(typeof content[0].data).toBe('string'); // base64
		expect(content[1].type).toBe('text');
		expect(content[1].text).toContain('Extract all visible text');
	});

	it('returns OCR result with text and source name', async () => {
		const buffer = makeImageBuffer();
		const result = await extractor.extract(buffer, 'photo.jpg');

		expect(result.text).toBe('Extracted text from image');
		expect(result.sourceName).toBe('photo.jpg');
	});

	it('handles "No text detected" response', async () => {
		mockChat.mockResolvedValue('No text detected.');
		const buffer = makeImageBuffer();
		const result = await extractor.extract(buffer, 'blank.png');

		expect(result.text).toBe('No text detected.');
	});

	it('uses vision model when configured', async () => {
		settings.image.visionModel = 'gpt-4o';
		settings.ai.model = 'gpt-4o-mini';

		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'screenshot.png');

		// The model should have been temporarily set to the vision model
		// and restored after the call
		expect(settings.ai.model).toBe('gpt-4o-mini');
	});

	it('falls back to default model when no vision model set', async () => {
		settings.image.visionModel = '';
		settings.ai.model = 'gpt-4o';

		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'screenshot.png');

		// Model should remain unchanged
		expect(settings.ai.model).toBe('gpt-4o');
		expect(mockChat).toHaveBeenCalledOnce();
	});

	it('maps jpeg extension to correct media type', async () => {
		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'photo.jpeg');

		const content = mockChat.mock.calls[0][0][1].content;
		expect(content[0].mediaType).toBe('image/jpeg');
	});

	it('maps jpg extension to correct media type', async () => {
		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'photo.jpg');

		const content = mockChat.mock.calls[0][0][1].content;
		expect(content[0].mediaType).toBe('image/jpeg');
	});

	it('maps webp extension to correct media type', async () => {
		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'photo.webp');

		const content = mockChat.mock.calls[0][0][1].content;
		expect(content[0].mediaType).toBe('image/webp');
	});

	it('defaults to image/png for unknown extensions', async () => {
		const buffer = makeImageBuffer();
		await extractor.extract(buffer, 'photo.xyz');

		const content = mockChat.mock.calls[0][0][1].content;
		expect(content[0].mediaType).toBe('image/png');
	});

	it('restores model even if chat throws', async () => {
		settings.image.visionModel = 'gpt-4o';
		settings.ai.model = 'gpt-4o-mini';
		mockChat.mockRejectedValue(new Error('API error'));

		const buffer = makeImageBuffer();
		await expect(extractor.extract(buffer, 'screenshot.png')).rejects.toThrow('API error');

		// Model should be restored
		expect(settings.ai.model).toBe('gpt-4o-mini');
	});
});
