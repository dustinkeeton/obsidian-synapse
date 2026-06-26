import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile, requestUrl } from '../__mocks__/obsidian';
import { ProposalGenerator } from './proposer';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { DetectionResult } from './types';
import type { NotificationManager } from '../shared';

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

// Mock the article fetcher (re-exported by ../shared) so non-Twitter URLs
// don't make real network calls. Other content-fetcher exports are passed
// through from the real module via importOriginal. Declared with vi.hoisted
// so the mock factory (hoisted above imports) can reference it safely.
const { mockFetchArticleContent } = vi.hoisted(() => ({
	mockFetchArticleContent: vi.fn().mockResolvedValue('Article body text here.'),
}));
vi.mock('../shared/content-fetcher', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../shared/content-fetcher')>();
	return {
		...actual,
		fetchArticleContent: mockFetchArticleContent,
	};
});

const mockRequestUrl = vi.mocked(requestUrl);

function makeSettings(): SynapseSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

/**
 * Minimal NotificationManager stand-in. ProposalGenerator only calls `info()`
 * to surface skipped/empty external-context fetches, so spying on that one
 * method is enough (the real NotificationManager's Notice DOM/CSS behavior is
 * verified live in Obsidian, not here).
 */
function makeNotifications() {
	return { info: vi.fn(), error: vi.fn() } as unknown as NotificationManager & {
		info: ReturnType<typeof vi.fn>;
		error: ReturnType<typeof vi.fn>;
	};
}

describe('ProposalGenerator -- image embed preservation (no images)', () => {
	let generator: ProposalGenerator;

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content here.');

		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue('# Note\n\nSome content with ![photo](https://example.com/img.png)'),
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
		generator = new ProposalGenerator(mockApp as any, () => settings, makeNotifications());
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
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue('# Trip Notes\n![[photo.png]]\nGreat view!'),
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
		generator = new ProposalGenerator(mockApp as any, () => settings, makeNotifications());
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

		expect(proposal).not.toBeNull();
		expect(proposal!.imageAnalysis).toBeDefined();
		expect(proposal!.imageAnalysis).toHaveLength(1);
		expect(proposal!.imageAnalysis![0].description).toBe('A photo of mountains at sunset');
	});

	it('omits imageAnalysis field when no images found', async () => {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue('# Plain Note\nNo images here'),
				read: vi.fn(),
				readBinary: vi.fn(),
			},
			metadataCache: {
				getCache: vi.fn().mockReturnValue(null),
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
		};

		const noImageGenerator = new ProposalGenerator(mockApp as any, () => settings, makeNotifications());

		const detection: DetectionResult = {
			notePath: 'notes/plain.md',
			reasons: [{ type: 'user-requested' }],
		};

		const proposal = await noImageGenerator.generate(detection);

		expect(proposal).not.toBeNull();
		expect(proposal!.imageAnalysis).toBeUndefined();
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
		expect(proposal).not.toBeNull();
		expect(proposal!.proposedAdditions).toBeDefined();
		expect(proposal!.imageAnalysis).toBeUndefined();

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

describe('ProposalGenerator -- Twitter URL external context', () => {
	let generator: ProposalGenerator;

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content with tweet context.');

		const noteContent = '# Thread Notes\n\nSee https://x.com/elonmusk/status/123456789\n\nGreat insight!';

		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue(noteContent),
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
		settings.image.enabled = false;
		generator = new ProposalGenerator(mockApp as any, () => settings, makeNotifications());

		mockRequestUrl.mockResolvedValue({
			text: JSON.stringify({
				html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">This is the tweet text</p></blockquote>',
				author_name: 'elonmusk',
			}),
		} as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('includes Twitter content as external context in prompt', async () => {
		const detection: DetectionResult = {
			notePath: 'notes/thread.md',
			reasons: [{ type: 'user-requested' }],
		};

		await generator.generate(detection);

		expect(mockComplete).toHaveBeenCalledOnce();
		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).toContain('External content referenced in this note:');
		expect(prompt).toContain('@elonmusk');
		expect(prompt).toContain('This is the tweet text');
	});

	it('gracefully handles tweet fetch failure', async () => {
		mockRequestUrl.mockRejectedValue(new Error('503'));

		const detection: DetectionResult = {
			notePath: 'notes/thread.md',
			reasons: [{ type: 'user-requested' }],
		};

		const proposal = await generator.generate(detection);
		// Should still produce a proposal — tweet fetch is non-fatal (note has prose)
		expect(proposal).not.toBeNull();
		expect(proposal!.proposedAdditions).toBeDefined();
		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).not.toContain('External content referenced in this note:');
	});
});

describe('ProposalGenerator -- article URL external context', () => {
	function makeGenerator(noteContent: string): {
		generator: ProposalGenerator;
		notifications: ReturnType<typeof makeNotifications>;
	} {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue(noteContent),
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
		settings.image.enabled = false;
		const notifications = makeNotifications();
		return {
			generator: new ProposalGenerator(mockApp as any, () => settings, notifications),
			notifications,
		};
	}

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content with article context.');
		mockFetchArticleContent.mockClear();
		mockFetchArticleContent.mockResolvedValue(
			'Source: https://example.com/post\nTitle: Example\n\nArticle body text here.'
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches a non-Twitter article URL into external context', async () => {
		const { generator } = makeGenerator(
			'# Notes\n\nSee https://example.com/post for details.'
		);

		await generator.generate({
			notePath: 'notes/article.md',
			reasons: [{ type: 'user-requested' }],
		});

		expect(mockFetchArticleContent).toHaveBeenCalledOnce();
		expect(mockFetchArticleContent).toHaveBeenCalledWith('https://example.com/post', 2000);

		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).toContain('External content referenced in this note:');
		expect(prompt).toContain('Article body text here.');
	});

	it('does not fetch known video hosts as articles', async () => {
		const { generator } = makeGenerator(
			'# Notes\n\nWatch https://www.youtube.com/watch?v=abc123 here.'
		);

		await generator.generate({
			notePath: 'notes/video.md',
			reasons: [{ type: 'user-requested' }],
		});

		expect(mockFetchArticleContent).not.toHaveBeenCalled();
		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).not.toContain('External content referenced in this note:');
	});

	it('surfaces a notification (no longer silent) when an article fetch fails', async () => {
		mockFetchArticleContent.mockRejectedValue(new Error('timeout'));
		const { generator, notifications } = makeGenerator(
			'# Notes\n\nSee https://example.com/broken here.'
		);

		const proposal = await generator.generate({
			notePath: 'notes/broken.md',
			reasons: [{ type: 'user-requested' }],
		});

		// Non-fatal: proposal still produced, no external context section
		expect(proposal).not.toBeNull();
		expect(proposal!.proposedAdditions).toBeDefined();
		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).not.toContain('External content referenced in this note:');

		// The failure is now surfaced to the user instead of swallowed.
		expect(notifications.error).toHaveBeenCalledTimes(1);
		const [msg] = notifications.error.mock.calls[0];
		expect(msg).toContain('Could not load content from https://example.com/broken');
		expect(msg).toContain('timeout');
	});

	it('surfaces a notification when an article fetch returns no readable text', async () => {
		mockFetchArticleContent.mockResolvedValue('   ');
		const { generator, notifications } = makeGenerator(
			'# Notes\n\nSee https://example.com/empty here.'
		);

		await generator.generate({
			notePath: 'notes/empty.md',
			reasons: [{ type: 'user-requested' }],
		});

		expect(notifications.error).toHaveBeenCalledTimes(1);
		const [msg] = notifications.error.mock.calls[0];
		expect(msg).toContain('Could not load content from https://example.com/empty');
		expect(msg).toContain('no readable text');
	});
});

describe('ProposalGenerator -- Reddit URL external context', () => {
	function makeGenerator(noteContent: string): {
		generator: ProposalGenerator;
		notifications: ReturnType<typeof makeNotifications>;
	} {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue(noteContent),
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
		settings.image.enabled = false;
		const notifications = makeNotifications();
		return {
			generator: new ProposalGenerator(mockApp as any, () => settings, notifications),
			notifications,
		};
	}

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content with reddit context.');
		mockFetchArticleContent.mockClear();
		mockFetchArticleContent.mockResolvedValue('SHOULD NOT BE USED');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('routes a Reddit URL to the Reddit RSS fetcher (not the article fetcher)', async () => {
		// reddit-fetcher is the real module here, so it hits the mocked
		// requestUrl: return a valid post Atom feed.
		mockRequestUrl.mockResolvedValue({
			status: 200,
			text:
				'<?xml version="1.0"?><feed><entry>' +
				'<author><name>/u/immich_fan</name></author>' +
				'<title>Immich backup tips</title>' +
				'<content type="html">&lt;p&gt;Use the CLI for bulk uploads.&lt;/p&gt;</content>' +
				'</entry></feed>',
		} as never);

		const { generator } = makeGenerator(
			'# Notes\n\nSaw this: https://www.reddit.com/r/immich/comments/abc123/title/'
		);

		await generator.generate({
			notePath: 'notes/reddit.md',
			reasons: [{ type: 'user-requested' }],
		});

		// Reddit must NOT fall through to the generic article fetcher.
		expect(mockFetchArticleContent).not.toHaveBeenCalled();

		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).toContain('External content referenced in this note:');
		expect(prompt).toContain('u/immich_fan');
		expect(prompt).toContain('Immich backup tips');
		expect(prompt).toContain('Use the CLI for bulk uploads.');
	});

	it('surfaces a notification when a Reddit fetch fails', async () => {
		mockRequestUrl.mockRejectedValue(new Error('403'));

		const { generator, notifications } = makeGenerator(
			'# Notes\n\nSaw this: https://www.reddit.com/r/immich/comments/abc123/title/'
		);

		const proposal = await generator.generate({
			notePath: 'notes/reddit-fail.md',
			reasons: [{ type: 'user-requested' }],
		});

		// Non-fatal — proposal still produced, but the failure is surfaced.
		expect(proposal).not.toBeNull();
		expect(proposal!.proposedAdditions).toBeDefined();
		expect(mockFetchArticleContent).not.toHaveBeenCalled();
		expect(notifications.error).toHaveBeenCalledTimes(1);
		const [msg] = notifications.error.mock.calls[0];
		expect(msg).toContain('Could not load content from https://www.reddit.com/r/immich/comments/abc123/title/');
	});
});

describe('ProposalGenerator -- link-dominated notes (anti-fabrication)', () => {
	const REDDIT_URL =
		'https://www.reddit.com/r/playrustservers/comments/82l3sk/what_is_rconip_and_rconport_used_for/';

	function makeGenerator(noteContent: string): {
		generator: ProposalGenerator;
		notifications: ReturnType<typeof makeNotifications>;
	} {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue(noteContent),
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
		settings.image.enabled = false;
		const notifications = makeNotifications();
		return {
			generator: new ProposalGenerator(mockApp as any, () => settings, notifications),
			notifications,
		};
	}

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Centered on the Reddit post.');
		mockFetchArticleContent.mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('centers the prompt on the fetched content when the note is just a link', async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			text:
				'<?xml version="1.0"?><feed><entry>' +
				'<author><name>/u/op</name></author>' +
				'<title>What is rcon.ip and rcon.port used for?</title>' +
				'<content type="html">&lt;p&gt;Running RustDedicated on Ubuntu in a VM.&lt;/p&gt;</content>' +
				'</entry></feed>',
		} as never);

		const { generator } = makeGenerator(REDDIT_URL);
		const proposal = await generator.generate({
			notePath: 'notes/link-only.md',
			reasons: [{ type: 'user-requested' }],
		});

		expect(proposal).not.toBeNull();
		const [prompt] = mockComplete.mock.calls[0];
		// A link-only note gets the "center on the source" instruction, not the
		// passive "External content referenced" phrasing.
		expect(prompt).toContain('Base your elaboration primarily on this fetched content');
		expect(prompt).not.toContain('External content referenced in this note:');
		expect(prompt).toContain('What is rcon.ip and rcon.port used for?');
		expect(prompt).toContain('Running RustDedicated on Ubuntu in a VM.');
	});

	it('returns null (no fabricated proposal) when the only link fails to load', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Too Many Requests'));

		const { generator, notifications } = makeGenerator(REDDIT_URL);
		const proposal = await generator.generate({
			notePath: 'notes/link-only-fail.md',
			reasons: [{ type: 'user-requested' }],
		});

		// The whole point: never invent an elaboration from the URL slug alone.
		expect(proposal).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
		// The failure is still surfaced to the user.
		expect(notifications.error).toHaveBeenCalledTimes(1);
		const [msg] = notifications.error.mock.calls[0];
		expect(msg).toContain('Could not load content from');
	});

	it('returns null when a link-only note\'s article fetch yields no readable text', async () => {
		const { generator, notifications } = makeGenerator('https://example.com/empty-page');
		mockFetchArticleContent.mockResolvedValue('   ');

		const proposal = await generator.generate({
			notePath: 'notes/empty-link.md',
			reasons: [{ type: 'user-requested' }],
		});

		expect(proposal).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
		expect(notifications.error).toHaveBeenCalledTimes(1);
	});

	it('still elaborates when a note has real prose alongside a failed link', async () => {
		mockRequestUrl.mockRejectedValue(new Error('Too Many Requests'));

		const { generator } = makeGenerator(
			'# RCON configuration\n\nNotes on remote console setup for my server. See ' +
			REDDIT_URL + ' for the original discussion thread and the follow-up answers.'
		);
		const proposal = await generator.generate({
			notePath: 'notes/with-prose.md',
			reasons: [{ type: 'user-requested' }],
		});

		// Real prose is present -> not link-dominated -> elaboration proceeds even
		// though the link fetch failed (conservative "only link-only notes" rule).
		expect(proposal).not.toBeNull();
		expect(mockComplete).toHaveBeenCalledOnce();
	});
});

describe('ProposalGenerator -- note title as elaboration signal (#387)', () => {
	function makeGenerator(noteContent: string): {
		generator: ProposalGenerator;
		notifications: ReturnType<typeof makeNotifications>;
	} {
		const mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => new TFile(path)),
				cachedRead: vi.fn().mockResolvedValue(noteContent),
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
		settings.image.enabled = false;
		const notifications = makeNotifications();
		return {
			generator: new ProposalGenerator(mockApp as any, () => settings, notifications),
			notifications,
		};
	}

	beforeEach(() => {
		mockComplete.mockClear();
		mockChat.mockClear();
		mockComplete.mockResolvedValue('Expanded content here.');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('includes the note title as context for a content-bearing note', async () => {
		// basename derives from the path: notes/Photosynthesis.md -> "Photosynthesis".
		const { generator } = makeGenerator(
			'# Photosynthesis\n\nThe process by which plants convert light into chemical energy.'
		);

		await generator.generate({
			notePath: 'notes/Photosynthesis.md',
			reasons: [{ type: 'user-requested' }],
		});

		expect(mockComplete).toHaveBeenCalledOnce();
		const [prompt] = mockComplete.mock.calls[0];
		expect(prompt).toContain('Note title: "Photosynthesis"');
		// The original content is still embedded between the --- markers.
		expect(prompt).toContain('The process by which plants convert light');
	});

	it('seeds the prompt from the title when the note body is empty', async () => {
		// Whitespace-only body, but a meaningful (non-generic) title.
		const { generator } = makeGenerator('   \n  ');

		const proposal = await generator.generate({
			notePath: 'notes/Quantum Tunneling.md',
			reasons: [{ type: 'short-note', wordCount: 0 }],
		});

		expect(proposal).not.toBeNull();
		expect(mockComplete).toHaveBeenCalledOnce();
		const [prompt] = mockComplete.mock.calls[0];
		// Title-led phrasing, with the title as the seed...
		expect(prompt).toContain('Note title: "Quantum Tunneling"');
		expect(prompt).toContain('This note has no body yet');
		// ...and NO empty `---`/`---` block (the bug this fixes: an empty body must
		// not be sent as nothing between the markers).
		expect(prompt).not.toContain('---');
	});

	it('refuses to fabricate for an empty note with a generic title (no AI call, fires a notice)', async () => {
		// Empty body + Obsidian "Untitled" default -> nothing to elaborate from.
		const { generator, notifications } = makeGenerator('');

		const proposal = await generator.generate({
			notePath: 'notes/Untitled.md',
			reasons: [{ type: 'short-note', wordCount: 0 }],
		});

		expect(proposal).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
		expect(notifications.info).toHaveBeenCalledOnce();
		const [msg] = notifications.info.mock.calls[0];
		expect(msg).toContain('Untitled');
	});

	it('refuses to fabricate for an empty note named after a date', async () => {
		// Empty body + date-style daily-note name -> also generic.
		const { generator, notifications } = makeGenerator('');

		const proposal = await generator.generate({
			notePath: 'daily/2026-06-25.md',
			reasons: [{ type: 'short-note', wordCount: 0 }],
		});

		expect(proposal).toBeNull();
		expect(mockComplete).not.toHaveBeenCalled();
		expect(notifications.info).toHaveBeenCalledOnce();
	});
});
