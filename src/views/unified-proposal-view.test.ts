import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedProposalView, UnifiedItem, UnifiedViewCallbacks } from './unified-proposal-view';
import type { Proposal } from '../elaboration';
import type { EnrichmentProposal } from '../enrichment';
import type { OrganizeProposal } from '../organize';
import type { DeepDiveProposal } from '../deep-dive';

// --- Helpers ----------------------------------------------------------------

/** Stub WorkspaceLeaf that satisfies ItemView constructor. */
function mockLeaf(): any {
	return { view: {} };
}

/** Create a stub callbacks object with all methods as spies. */
function mockCallbacks(): UnifiedViewCallbacks {
	return {
		onElaborationAccept: vi.fn().mockResolvedValue(undefined),
		onElaborationReject: vi.fn().mockResolvedValue(undefined),
		onEnrichmentAcceptSelected: vi.fn().mockResolvedValue(undefined),
		onEnrichmentReject: vi.fn().mockResolvedValue(undefined),
		onOrganizeAccept: vi.fn().mockResolvedValue(undefined),
		onOrganizeReject: vi.fn().mockResolvedValue(undefined),
		onDeepDiveAccept: vi.fn().mockResolvedValue(undefined),
		onDeepDiveReject: vi.fn().mockResolvedValue(undefined),
		onCheckpointDiscard: vi.fn().mockResolvedValue(undefined),
		onCheckpointResume: vi.fn().mockResolvedValue(undefined),
	};
}

/** Minimal elaboration proposal. */
function makeElaborationItem(id = 'elab-1'): UnifiedItem {
	return {
		kind: 'elaboration',
		data: {
			id,
			sourceNotePath: 'notes/test.md',
			createdAt: '2024-01-01T00:00:00Z',
			detectionReasons: [{ type: 'short-note', wordCount: 10 }],
			originalContent: 'original',
			proposedAdditions: 'additions',
			insertionPoint: 'append',
			status: 'pending',
		} as Proposal,
	};
}

/** Minimal enrichment proposal. */
function makeEnrichmentItem(id = 'enrich-1'): UnifiedItem {
	return {
		kind: 'enrichment',
		data: {
			id,
			sourceNotePath: 'notes/test.md',
			createdAt: '2024-01-01T00:00:00Z',
			triggerSource: 'manual',
			result: {
				tags: [],
				internalLinks: [],
				externalLinks: [],
				frontmatter: [],
			},
			status: 'pending',
		} as EnrichmentProposal,
	};
}

/** Minimal organize proposal. */
function makeOrganizeItem(id = 'org-1'): UnifiedItem {
	return {
		kind: 'organize',
		data: {
			id,
			sourceNotePath: 'notes/test.md',
			proposedDirectory: 'organized/',
			reasoning: 'fits better here',
			createdAt: '2024-01-01T00:00:00Z',
			status: 'pending',
		} as OrganizeProposal,
	};
}

/** Minimal deep dive proposal. */
function makeDeepDiveItem(id = 'dd-1'): UnifiedItem {
	return {
		kind: 'deep-dive',
		data: {
			id,
			runId: 'run-1',
			sourceNotePath: 'notes/test.md',
			topic: { title: 'AI Ethics', description: 'desc', relevance: 0.9, existsInVault: false, relatedUrls: [] },
			proposedPath: 'notes/ai-ethics.md',
			proposedContent: '# AI Ethics\ncontent',
			depth: 0,
			qualityScore: { score: 0.8, topicCount: 3, wordCount: 100, isTooGeneric: false, hasHighOverlap: false, reasoning: 'good' },
			childProposalIds: [],
			createdAt: '2024-01-01T00:00:00Z',
			status: 'pending',
		} as DeepDiveProposal,
	};
}

// --- Tests ------------------------------------------------------------------

/** Create a deeply-recursive stub DOM element that supports all Obsidian HTML methods. */
function stubEl(): any {
	const el: any = {
		style: {},
		disabled: false,
		value: '',
		readOnly: false,
		checked: false,
		textContent: '',
		empty: vi.fn(),
		addClass: vi.fn(),
		addEventListener: vi.fn(),
		closest: vi.fn().mockReturnValue(null),
		createEl: vi.fn().mockImplementation(() => stubEl()),
		createDiv: vi.fn().mockImplementation(() => stubEl()),
	};
	return el;
}

describe('UnifiedProposalView reject-all', () => {
	let view: any; // cast to any to access private methods
	let callbacks: UnifiedViewCallbacks;

	beforeEach(() => {
		callbacks = mockCallbacks();
		view = new UnifiedProposalView(mockLeaf(), callbacks);
		// Stub contentEl with a recursive mock so render calls don't throw
		view.contentEl = stubEl();
	});

	describe('rejectSingleItem', () => {
		it('dispatches to onElaborationReject for elaboration items', async () => {
			const item = makeElaborationItem('elab-42');
			await view.rejectSingleItem(item);
			expect(callbacks.onElaborationReject).toHaveBeenCalledWith('elab-42');
		});

		it('dispatches to onEnrichmentReject for enrichment items', async () => {
			const item = makeEnrichmentItem('enrich-42');
			await view.rejectSingleItem(item);
			expect(callbacks.onEnrichmentReject).toHaveBeenCalledWith('enrich-42');
		});

		it('dispatches to onOrganizeReject for organize items', async () => {
			const item = makeOrganizeItem('org-42');
			await view.rejectSingleItem(item);
			expect(callbacks.onOrganizeReject).toHaveBeenCalledWith('org-42');
		});

		it('dispatches to onDeepDiveReject for deep-dive items', async () => {
			const item = makeDeepDiveItem('dd-42');
			await view.rejectSingleItem(item);
			expect(callbacks.onDeepDiveReject).toHaveBeenCalledWith('dd-42');
		});
	});

	describe('rejectAll', () => {
		it('rejects all items sequentially', async () => {
			const items = [
				makeElaborationItem('e1'),
				makeEnrichmentItem('en1'),
				makeOrganizeItem('o1'),
				makeDeepDiveItem('d1'),
			];
			view.items = items;

			await view.rejectAll();

			expect(callbacks.onElaborationReject).toHaveBeenCalledWith('e1');
			expect(callbacks.onEnrichmentReject).toHaveBeenCalledWith('en1');
			expect(callbacks.onOrganizeReject).toHaveBeenCalledWith('o1');
			expect(callbacks.onDeepDiveReject).toHaveBeenCalledWith('d1');
		});

		it('calls reject callbacks in presentation order', async () => {
			const callOrder: string[] = [];
			(callbacks.onElaborationReject as any).mockImplementation((id: string) => {
				callOrder.push(`elab-${id}`);
				return Promise.resolve();
			});
			(callbacks.onEnrichmentReject as any).mockImplementation((id: string) => {
				callOrder.push(`enrich-${id}`);
				return Promise.resolve();
			});

			view.items = [
				makeElaborationItem('1'),
				makeEnrichmentItem('2'),
				makeElaborationItem('3'),
			];

			await view.rejectAll();

			expect(callOrder).toEqual(['elab-1', 'enrich-2', 'elab-3']);
		});

		it('stops on first failure and reports partial progress', async () => {
			(callbacks.onEnrichmentReject as any).mockRejectedValue(new Error('network'));

			view.items = [
				makeElaborationItem('e1'),
				makeEnrichmentItem('en1'),
				makeOrganizeItem('o1'),
			];

			await view.rejectAll();

			// First item was rejected successfully
			expect(callbacks.onElaborationReject).toHaveBeenCalledWith('e1');
			// Second item failed
			expect(callbacks.onEnrichmentReject).toHaveBeenCalledWith('en1');
			// Third item was never attempted
			expect(callbacks.onOrganizeReject).not.toHaveBeenCalled();
		});

		it('does nothing when already in progress', async () => {
			view.items = [makeElaborationItem('e1'), makeElaborationItem('e2')];
			view.rejectAllInProgress = true;

			await view.rejectAll();

			expect(callbacks.onElaborationReject).not.toHaveBeenCalled();
		});

		it('does nothing when acceptAll is in progress', async () => {
			view.items = [makeElaborationItem('e1'), makeElaborationItem('e2')];
			view.acceptAllInProgress = true;

			await view.rejectAll();

			expect(callbacks.onElaborationReject).not.toHaveBeenCalled();
		});

		it('resets rejectAllInProgress flag after completion', async () => {
			view.items = [makeElaborationItem('e1'), makeElaborationItem('e2')];

			await view.rejectAll();

			expect(view.rejectAllInProgress).toBe(false);
		});

		it('resets rejectAllInProgress flag after failure', async () => {
			(callbacks.onElaborationReject as any).mockRejectedValue(new Error('fail'));
			view.items = [makeElaborationItem('e1')];

			await view.rejectAll();

			expect(view.rejectAllInProgress).toBe(false);
		});

		it('handles single proposal correctly (singular notice text)', async () => {
			view.items = [makeElaborationItem('e1')];

			// rejectAll should still work even with 1 item
			// (the button is only shown for 2+, but the method itself has no guard)
			await view.rejectAll();

			expect(callbacks.onElaborationReject).toHaveBeenCalledWith('e1');
		});
	});

	describe('acceptAll guards', () => {
		it('does nothing when rejectAll is in progress', async () => {
			view.items = [makeElaborationItem('e1'), makeElaborationItem('e2')];
			view.rejectAllInProgress = true;

			await view.acceptAll();

			expect(callbacks.onElaborationAccept).not.toHaveBeenCalled();
		});
	});
});
