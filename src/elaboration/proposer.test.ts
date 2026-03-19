import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from '../__mocks__/obsidian';
import { ProposalGenerator } from './proposer';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { DetectionResult } from './types';

const mockComplete = vi.fn().mockResolvedValue('Expanded content here.');
const mockChat = vi.fn().mockResolvedValue(
	'DESCRIPTION: A photo of mountains\n\nLOCATION: Rocky Mountains\n\nMETADATA: No metadata observations.'
);

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
		chat = mockChat;
	},
}));

function makeSettings(): SynapseSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

describe('ProposalGenerator -- image embed preservation (no images)', () => {
	let generator: ProposalGenerator;

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content here.');

		const mockApp = {
			vault: {
				adapter: {
					read: vi.fn().mockResolvedValue('# Note\n\nSome content with ![photo](https://example.com/img.png)'),
				},
				read: vi.fn(),
				readBinary: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
		};

		const settings = makeSettings();
		settings.elaboration.proposal.includeSourceContext = false;
		// Disable image analysis so these tests stay focused on original behavior
		settings.image.enabled = false;
		generator = new ProposalGenerator(mockApp as any, () => settings);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('includes image embed preservation instruction in system prompt', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/test.md',
			reasons: [{ type: 'user-requested' }],
		};

		await generator.generate(detection);

		expect(mockComplete).toHaveBeenCalledOnce();
		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain(
			'preserve them as markdown image embeds (![alt](url))'
		);
		expect(systemPrompt).toContain('embed them as ![[image.jpg]]');
	});

	it('includes image embed instruction for stub detection as well', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/stub.md',
			reasons: [{ type: 'short-note', wordCount: 10 }],
		};

		await generator.generate(detection);

		expect(mockComplete).toHaveBeenCalledOnce();
		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain(
			'preserve them as markdown image embeds (![alt](url))'
		);
		expect(systemPrompt).toContain('embed them as ![[image.jpg]]');
	});
});

describe('ProposalGenerator -- image analysis integration', () => {
	let generator: ProposalGenerator;
	let settings: SynapseSettings;

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content referencing the mountain photo.');
		mockChat.mockResolvedValue(
			'DESCRIPTION: A photo of mountains at sunset\n\nLOCATION: Rocky Mountains, Colorado\n\nMETADATA: No metadata observations.'
		);

		const imageFile = new TFile('assets/photo.png');

		const mockApp = {
			vault: {
				adapter: {
					read: vi.fn().mockResolvedValue('# Trip Notes\n![[photo.png]]\nGreat view!'),
				},
				read: vi.fn(),
				readBinary: vi.fn().mockResolvedValue(new Uint8Array([137, 80]).buffer),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(imageFile),
			},
		};

		settings = makeSettings();
		settings.elaboration.proposal.includeSourceContext = false;
		settings.image.enabled = true;
		generator = new ProposalGenerator(mockApp as any, () => settings);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses image-aware system prompt when image analysis is available', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/trip.md',
			reasons: [{ type: 'user-requested' }],
		};

		await generator.generate(detection);

		expect(mockComplete).toHaveBeenCalledOnce();
		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('Image analysis has been provided');
		expect(systemPrompt).toContain('Preserve all image embeds in their original format');
		// Should NOT contain the generic image preservation instruction
		expect(systemPrompt).not.toContain('preserve them as markdown image embeds');
	});

	it('includes image analysis in prompt', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/trip.md',
			reasons: [{ type: 'user-requested' }],
		};

		await generator.generate(detection);

		expect(mockComplete).toHaveBeenCalledOnce();
		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).toContain('Image analysis from this note:');
		expect(prompt).toContain('A photo of mountains at sunset');
		expect(prompt).toContain('Rocky Mountains, Colorado');
	});

	it('stores image analysis results in proposal', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/trip.md',
			reasons: [{ type: 'user-requested' }],
		};

		const proposal = await generator.generate(detection);

		expect(proposal.imageAnalysis).toBeDefined();
		expect(proposal.imageAnalysis).toHaveLength(1);
		expect(proposal.imageAnalysis![0].description).toBe('A photo of mountains at sunset');
	});

	it('omits imageAnalysis field when no images found', async () => {
		const mockApp = {
			vault: {
				adapter: {
					read: vi.fn().mockResolvedValue('# Plain Note\nNo images here'),
				},
				read: vi.fn(),
				readBinary: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
		};

		const noImageGenerator = new ProposalGenerator(mockApp as any, () => settings);

		const detection: DetectionResult = {
			notePath: 'notes/plain.md',
			reasons: [{ type: 'user-requested' }],
		};

		const proposal = await noImageGenerator.generate(detection);

		expect(proposal.imageAnalysis).toBeUndefined();
	});

	it('falls back to generic prompt when image analysis fails', async () => {
		mockChat.mockRejectedValue(new Error('API error'));
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const detection: DetectionResult = {
			notePath: 'notes/trip.md',
			reasons: [{ type: 'user-requested' }],
		};

		const proposal = await generator.generate(detection);

		// Should still generate a proposal
		expect(proposal.proposedAdditions).toBeDefined();
		expect(proposal.imageAnalysis).toBeUndefined();

		// Should use the non-image system prompt
		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('preserve them as markdown image embeds');

		warnSpy.mockRestore();
	});

	it('skips image analysis when image module is disabled', async () => {
		settings.image.enabled = false;

		const detection: DetectionResult = {
			notePath: 'notes/trip.md',
			reasons: [{ type: 'user-requested' }],
		};

		await generator.generate(detection);

		// Image AI should not be called
		expect(mockChat).not.toHaveBeenCalled();

		// Should use generic system prompt
		const [, systemPrompt] = mockComplete.mock.calls[0];
		expect(systemPrompt).toContain('preserve them as markdown image embeds');
	});

	it('excludes "No metadata observations" from image context', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/trip.md',
			reasons: [{ type: 'user-requested' }],
		};

		await generator.generate(detection);

		const [prompt] = mockComplete.mock.calls[0];
		// "No metadata observations." should be filtered from the context
		expect(prompt).not.toContain('No metadata observations.');
	});
});
