import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from '../__mocks__/obsidian';
import { ImageAnalyzer, MAX_IMAGES_PER_NOTE } from './image-analyzer';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';

const mockChat = vi.fn().mockResolvedValue(
	'DESCRIPTION: A sunset over mountains\n\nLOCATION: Rocky Mountain range, Colorado\n\nMETADATA: Taken during golden hour, approximately 6pm'
);

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		chat = mockChat;
	},
}));

function makeSettings(overrides?: Partial<SynapseSettings>): SynapseSettings {
	return { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
}

function makeImageBuffer(): ArrayBuffer {
	const data = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	return data.buffer;
}

describe('ImageAnalyzer.findImageReferences', () => {
	let analyzer: ImageAnalyzer;

	beforeEach(() => {
		const settings = makeSettings();
		const mockApp = {
			vault: { readBinary: vi.fn() },
			metadataCache: { getFirstLinkpathDest: vi.fn() },
		};
		analyzer = new ImageAnalyzer(mockApp as any, () => settings, { info: vi.fn() } as any);
	});

	it('finds wiki-link images', () => {
		const content = 'Some text\n![[photo.png]]\nMore text';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(1);
		expect(refs[0].reference).toBe('![[photo.png]]');
		expect(refs[0].path).toBe('photo.png');
		expect(refs[0].isInternal).toBe(true);
	});

	it('finds markdown images with local paths', () => {
		const content = 'Some text\n![alt text](assets/photo.jpg)\nMore text';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(1);
		expect(refs[0].reference).toBe('![alt text](assets/photo.jpg)');
		expect(refs[0].path).toBe('assets/photo.jpg');
		expect(refs[0].isInternal).toBe(true);
	});

	it('skips external URLs in markdown images', () => {
		const content = '![photo](https://example.com/img.png)\n![local](local.png)';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(1);
		expect(refs[0].path).toBe('local.png');
	});

	it('skips http external URLs', () => {
		const content = '![photo](http://example.com/img.png)';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(0);
	});

	it('deduplicates same image referenced twice', () => {
		const content = '![[photo.png]]\nSome text\n![[photo.png]]';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(1);
	});

	it('returns empty for content with no images', () => {
		const content = '# Title\n\nJust plain text with no images.';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(0);
	});

	it('handles mixed wiki-link and markdown images', () => {
		const content = '![[photo.png]]\n![alt](diagram.jpg)\n![[chart.gif]]';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(3);
		// Wiki-link images are collected first, then markdown images
		expect(refs[0].path).toBe('photo.png');
		expect(refs[1].path).toBe('chart.gif');
		expect(refs[2].path).toBe('diagram.jpg');
	});

	it('respects MAX_IMAGES_PER_NOTE limit', () => {
		const images = Array.from({ length: 8 }, (_, i) => `![[img${i}.png]]`).join('\n');
		const refs = analyzer.findImageReferences(images);

		expect(refs).toHaveLength(MAX_IMAGES_PER_NOTE);
	});

	it('finds images with various supported extensions', () => {
		const content = [
			'![[photo.jpg]]',
			'![[photo.jpeg]]',
			'![[photo.gif]]',
			'![[photo.webp]]',
			'![[photo.bmp]]',
		].join('\n');
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(5);
	});

	it('is case-insensitive for extensions in wiki-links', () => {
		const content = '![[Photo.PNG]]\n![[image.JPG]]';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(2);
	});

	it('does not match non-image wiki-links', () => {
		const content = '![[document.pdf]]\n![[note.md]]\n![[photo.png]]';
		const refs = analyzer.findImageReferences(content);

		expect(refs).toHaveLength(1);
		expect(refs[0].path).toBe('photo.png');
	});
});

describe('ImageAnalyzer.parseAnalysisResponse', () => {
	let analyzer: ImageAnalyzer;

	beforeEach(() => {
		const settings = makeSettings();
		const mockApp = {
			vault: { readBinary: vi.fn() },
			metadataCache: { getFirstLinkpathDest: vi.fn() },
		};
		analyzer = new ImageAnalyzer(mockApp as any, () => settings, { info: vi.fn() } as any);
	});

	it('parses well-formed DESCRIPTION/LOCATION/METADATA response', () => {
		const response = 'DESCRIPTION: A sunset over mountains\n\nLOCATION: Rocky Mountain range\n\nMETADATA: Golden hour lighting';
		const result = analyzer.parseAnalysisResponse('![[photo.png]]', response);

		expect(result.reference).toBe('![[photo.png]]');
		expect(result.description).toBe('A sunset over mountains');
		expect(result.locationHints).toBe('Rocky Mountain range');
		expect(result.metadata).toBe('Golden hour lighting');
	});

	it('handles missing sections gracefully', () => {
		const response = 'DESCRIPTION: A diagram showing architecture';
		const result = analyzer.parseAnalysisResponse('![[diagram.png]]', response);

		expect(result.description).toBe('A diagram showing architecture');
		expect(result.locationHints).toBe('');
		expect(result.metadata).toBe('');
	});

	it('uses full response as description when format does not match', () => {
		const response = 'This is a photo of a cat sitting on a windowsill.';
		const result = analyzer.parseAnalysisResponse('![[cat.jpg]]', response);

		expect(result.description).toBe('This is a photo of a cat sitting on a windowsill.');
		expect(result.locationHints).toBe('');
		expect(result.metadata).toBe('');
	});

	it('handles multiline section content', () => {
		const response = [
			'DESCRIPTION: A complex diagram showing:',
			'- System architecture',
			'- Data flow between components',
			'',
			'LOCATION: No location clues detected.',
			'',
			'METADATA: High resolution, appears to be a screen capture',
		].join('\n');
		const result = analyzer.parseAnalysisResponse('![[arch.png]]', response);

		expect(result.description).toContain('System architecture');
		expect(result.description).toContain('Data flow between components');
		expect(result.locationHints).toBe('No location clues detected.');
		expect(result.metadata).toBe('High resolution, appears to be a screen capture');
	});
});

describe('ImageAnalyzer.analyzeImagesInNote', () => {
	let analyzer: ImageAnalyzer;
	let settings: SynapseSettings;
	let mockApp: any;

	beforeEach(() => {
		mockChat.mockClear();
		mockChat.mockResolvedValue(
			'DESCRIPTION: A sunset over mountains\n\nLOCATION: Rocky Mountain range\n\nMETADATA: Golden hour lighting'
		);

		settings = makeSettings();

		const imageFile = new TFile('assets/photo.png');

		mockApp = {
			vault: {
				readBinary: vi.fn().mockResolvedValue(makeImageBuffer()),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn().mockReturnValue(imageFile),
			},
		};

		analyzer = new ImageAnalyzer(mockApp as any, () => settings, { info: vi.fn() } as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns empty array when no images found', async () => {
		const results = await analyzer.analyzeImagesInNote('notes/test.md', '# No images here');
		expect(results).toHaveLength(0);
	});

	it('returns empty array when image module is disabled', async () => {
		settings.image.enabled = false;
		const results = await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'# Title\n![[photo.png]]'
		);
		expect(results).toHaveLength(0);
	});

	it('analyzes images and returns structured results', async () => {
		const results = await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'# Trip Notes\n![[photo.png]]\nGreat view!'
		);

		expect(results).toHaveLength(1);
		expect(results[0].reference).toBe('![[photo.png]]');
		expect(results[0].description).toBe('A sunset over mountains');
		expect(results[0].locationHints).toBe('Rocky Mountain range');
		expect(results[0].metadata).toBe('Golden hour lighting');
	});

	it('sends correct content blocks to AIClient', async () => {
		await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'# Title\n![[photo.png]]'
		);

		expect(mockChat).toHaveBeenCalledOnce();
		const messages = mockChat.mock.calls[0][0];

		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('image analysis assistant');

		const content = messages[1].content;
		expect(Array.isArray(content)).toBe(true);
		expect(content).toHaveLength(2);
		expect(content[0].type).toBe('image');
		expect(content[0].mediaType).toBe('image/png');
		expect(content[1].type).toBe('text');
		expect(content[1].text).toContain('DESCRIPTION');
		expect(content[1].text).toContain('LOCATION');
		expect(content[1].text).toContain('METADATA');
	});

	it('skips images that cannot be resolved', async () => {
		mockApp.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

		const results = await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'# Title\n![[missing.png]]'
		);

		expect(results).toHaveLength(0);
		expect(mockChat).not.toHaveBeenCalled();
	});

	it('gracefully handles per-image failures', async () => {
		const imageFile = new TFile('assets/photo.png');
		const secondFile = new TFile('assets/second.jpg');

		mockApp.metadataCache.getFirstLinkpathDest
			.mockReturnValueOnce(imageFile)
			.mockReturnValueOnce(secondFile);

		mockApp.vault.readBinary
			.mockRejectedValueOnce(new Error('File read error'))
			.mockResolvedValueOnce(makeImageBuffer());

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const results = await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'![[photo.png]]\n![[second.jpg]]'
		);

		// First image failed, second succeeded
		expect(results).toHaveLength(1);
		expect(results[0].reference).toBe('![[second.jpg]]');
		expect(warnSpy).toHaveBeenCalled();

		warnSpy.mockRestore();
	});

	it('uses vision model when configured', async () => {
		settings.image.visionModel = 'gpt-4o';
		settings.ai.model = 'gpt-4o-mini';

		await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'![[photo.png]]'
		);

		// Model should be restored after the call
		expect(settings.ai.model).toBe('gpt-4o-mini');
	});

	it('restores model even if chat throws', async () => {
		settings.image.visionModel = 'gpt-4o';
		settings.ai.model = 'gpt-4o-mini';
		mockChat.mockRejectedValue(new Error('API error'));

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await analyzer.analyzeImagesInNote(
			'notes/test.md',
			'![[photo.png]]'
		);

		expect(settings.ai.model).toBe('gpt-4o-mini');
		warnSpy.mockRestore();
	});
});
