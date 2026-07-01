import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnrichmentApplier } from './enrichment-applier';
import { EnrichmentProposal, AcceptedItems } from './types';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile } from '../__test-utils__/mock-factories';
import { CALLOUT_TYPES } from '../shared';
import type { App } from 'obsidian';

function makeSettings(): SynapseSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

function emptyResult(): EnrichmentProposal['result'] {
	return { tags: [], internalLinks: [], externalLinks: [], frontmatter: [] };
}

function makeProposal(overrides: Partial<EnrichmentProposal> = {}): EnrichmentProposal {
	return {
		id: 'prop-1',
		sourceNotePath: 'notes/Test.md',
		createdAt: '2026-06-11T00:00:00.000Z',
		triggerSource: 'manual',
		result: emptyResult(),
		status: 'pending',
		...overrides,
	};
}

function emptyAccepted(): AcceptedItems {
	return { tags: [], internalLinks: [], externalLinks: [], frontmatter: [] };
}

describe('EnrichmentApplier', () => {
	let app: ReturnType<typeof createMockApp>;
	let applier: EnrichmentApplier;
	let settings: SynapseSettings;

	beforeEach(() => {
		app = createMockApp();
		settings = makeSettings();
		applier = new EnrichmentApplier(app as unknown as App, () => settings);
	});

	/** Run apply() and return the content the atomic process() transform produced. */
	async function runApply(
		content: string,
		proposal: EnrichmentProposal,
		accepted: AcceptedItems,
		path = proposal.sourceNotePath
	): Promise<string> {
		const file = mockFile(path);
		app.vault.getAbstractFileByPath.mockReturnValue(file);
		app.vault.read.mockResolvedValue(content);
		await applier.apply(proposal, accepted);
		// `process` is the atomic read->transform->write mock; its first call's
		// result value is the written content (vitest types it as `any`).
		const written = (await app.vault.process.mock.results[0].value) as unknown as string;
		return written;
	}

	describe('apply', () => {
		it('does nothing when the source note is not a TFile', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			await applier.apply(makeProposal(), emptyAccepted());
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('merges accepted tags into frontmatter (stripping the leading #)', async () => {
			const proposal = makeProposal();
			const accepted: AcceptedItems = { ...emptyAccepted(), tags: ['#ml', '#ai'] };
			const result = await runApply('# Note body\n', proposal, accepted);

			expect(result).toContain('tags:');
			expect(result).toContain('- ml');
			expect(result).toContain('- ai');
			expect(result).not.toContain('#ml');
		});

		it('does not duplicate tags already present in frontmatter', async () => {
			const proposal = makeProposal();
			const accepted: AcceptedItems = { ...emptyAccepted(), tags: ['#ml'] };
			const result = await runApply('---\ntags: [ml]\n---\nBody\n', proposal, accepted);

			const occurrences = result.split('\n').filter((l) => l.trim() === '- ml');
			expect(occurrences).toHaveLength(1);
		});

		it('adds a Related Notes enrichment callout for accepted internal links', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					internalLinks: [
						{ targetPath: 'notes/Other.md', displayText: 'Other', relevanceScore: 0.9, reason: 'shares 3 tags' },
					],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), internalLinks: ['notes/Other.md'] };
			const result = await runApply('Body text\n', proposal, accepted);

			expect(result).toContain(`> [!${CALLOUT_TYPES.enrichment}] Related Notes`);
			expect(result).toContain('[[Other]] — shares 3 tags');
		});

		it('only includes internal links whose targetPath was accepted', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					internalLinks: [
						{ targetPath: 'notes/Yes.md', displayText: 'Yes', relevanceScore: 0.9, reason: 'r1' },
						{ targetPath: 'notes/No.md', displayText: 'No', relevanceScore: 0.8, reason: 'r2' },
					],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), internalLinks: ['notes/Yes.md'] };
			const result = await runApply('Body\n', proposal, accepted);

			expect(result).toContain('[[Yes]]');
			expect(result).not.toContain('[[No]]');
		});

		it('sanitizes wikilink/markdown metacharacters out of link display text and reason', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					internalLinks: [
						{ targetPath: 'notes/Evil.md', displayText: 'Ev[il]|x', relevanceScore: 0.9, reason: 'a (b) c' },
					],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), internalLinks: ['notes/Evil.md'] };
			const result = await runApply('Body\n', proposal, accepted);

			expect(result).toContain('[[Evilx]] — a b c');
		});

		it('adds a References callout for accepted external links', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					externalLinks: [
						{ url: 'https://example.com', title: 'Example', reason: 'authoritative' },
					],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), externalLinks: ['https://example.com'] };
			const result = await runApply('Body\n', proposal, accepted);

			expect(result).toContain(`> [!${CALLOUT_TYPES.enrichment}] References`);
			expect(result).toContain('[Example](https://example.com) — authoritative');
		});

		it('skips external links with non-HTTP(S) schemes', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					externalLinks: [
						{ url: 'javascript:alert(1)', title: 'Bad', reason: 'evil' },
						{ url: 'not a url', title: 'Invalid', reason: 'broken' },
						{ url: 'https://ok.com', title: 'Good', reason: 'fine' },
					],
				},
			});
			const accepted: AcceptedItems = {
				...emptyAccepted(),
				externalLinks: ['javascript:alert(1)', 'not a url', 'https://ok.com'],
			};
			const result = await runApply('Body\n', proposal, accepted);

			expect(result).toContain('[Good](https://ok.com)');
			expect(result).not.toContain('javascript:');
			expect(result).not.toContain('Invalid');
		});

		it('merges frontmatter array values without overwriting existing entries', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					frontmatter: [{ key: 'topics', value: ['b', 'c'], action: 'merge' }],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), frontmatter: ['topics'] };
			const result = await runApply('---\ntopics: [a]\n---\nBody\n', proposal, accepted);

			expect(result).toContain('- a');
			expect(result).toContain('- b');
			expect(result).toContain('- c');
		});

		it('adds a scalar frontmatter attribute when the key does not already exist', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					frontmatter: [{ key: 'category', value: 'reference', action: 'add' }],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), frontmatter: ['category'] };
			const result = await runApply('Body\n', proposal, accepted);

			expect(result).toContain('category: reference');
		});

		it('never overwrites an existing frontmatter key on an add action', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					frontmatter: [{ key: 'category', value: 'new', action: 'add' }],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), frontmatter: ['category'] };
			const result = await runApply('---\ncategory: original\n---\nBody\n', proposal, accepted);

			expect(result).toContain('category: original');
			expect(result).not.toContain('category: new');
		});

		it('ignores frontmatter enrichments whose key was not accepted', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					frontmatter: [{ key: 'status', value: 'draft', action: 'add' }],
				},
			});
			const result = await runApply('Body\n', proposal, emptyAccepted());

			expect(result).not.toContain('status: draft');
		});

		it('is idempotent — re-applying replaces the previous enrichment callout rather than stacking', async () => {
			const proposal = makeProposal({
				result: {
					...emptyResult(),
					internalLinks: [
						{ targetPath: 'notes/Other.md', displayText: 'Other', relevanceScore: 0.9, reason: 'reason' },
					],
				},
			});
			const accepted: AcceptedItems = { ...emptyAccepted(), internalLinks: ['notes/Other.md'] };
			const first = await runApply('Body\n', proposal, accepted);

			// Feed the already-enriched content back in.
			app.vault.read.mockResolvedValue(first);
			await applier.apply(proposal, accepted);
			const second = (await app.vault.process.mock.results[1].value) as unknown as string;

			const headerCount = second
				.split('\n')
				.filter((l) => l.includes(`[!${CALLOUT_TYPES.enrichment}] Related Notes`)).length;
			expect(headerCount).toBe(1);
		});
	});

	describe('undo', () => {
		it('does nothing when the proposal has no acceptedItems', async () => {
			await applier.undo(makeProposal());
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('does nothing when the source note is not a TFile', async () => {
			app.vault.getAbstractFileByPath.mockReturnValue(null);
			await applier.undo(makeProposal({ acceptedItems: emptyAccepted() }));
			expect(app.vault.process).not.toHaveBeenCalled();
		});

		it('removes accepted tags, frontmatter keys, and the enrichment callout', async () => {
			const proposal = makeProposal({
				acceptedItems: {
					tags: ['#ml'],
					internalLinks: [],
					externalLinks: [],
					frontmatter: ['category'],
				},
			});
			const enriched =
				'---\ntags: [ml, keep]\ncategory: reference\n---\n' +
				'Body\n\n' +
				`> [!${CALLOUT_TYPES.enrichment}] Related Notes\n> - [[Other]] — reason\n`;

			const file = mockFile(proposal.sourceNotePath);
			app.vault.getAbstractFileByPath.mockReturnValue(file);
			app.vault.read.mockResolvedValue(enriched);
			await applier.undo(proposal);
			const result = (await app.vault.process.mock.results[0].value) as unknown as string;

			expect(result).not.toContain('- ml');
			expect(result).toContain('- keep');
			expect(result).not.toContain('category: reference');
			expect(result).not.toContain(`[!${CALLOUT_TYPES.enrichment}]`);
		});
	});
});
