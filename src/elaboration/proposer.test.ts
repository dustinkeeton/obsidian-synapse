import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProposalGenerator } from './proposer';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { DetectionResult } from './types';

const mockComplete = vi.fn().mockResolvedValue('Expanded content here.');

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
	},
}));

describe('ProposalGenerator — image embed preservation', () => {
	let generator: ProposalGenerator;

	beforeEach(() => {
		mockComplete.mockClear();
		mockComplete.mockResolvedValue('Expanded content here.');

		const mockApp = {
			vault: {
				adapter: {
					read: vi.fn().mockResolvedValue('# Note\n\nSome content with ![photo](https://example.com/img.png)'),
				},
				read: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
		};

		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.elaboration.proposal.includeSourceContext = false;
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
	});
});
