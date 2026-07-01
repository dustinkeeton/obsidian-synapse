import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnifiedProposalView, UnifiedItem, UnifiedViewCallbacks } from './unified-proposal-view';
import { NotificationManager } from '../shared/notifications';
import type { TitleProposal } from '../title';
import { createEl, type StubEl } from '../__mocks__/obsidian';
import type { WorkspaceLeaf } from 'obsidian';

/**
 * The private surface of {@link UnifiedProposalView} these tests reach into via
 * a boundary cast (real instance, internal methods/fields exercised directly).
 */
interface ViewInternals {
	items: UnifiedItem[];
	rejectAllInProgress: boolean;
	acceptAllInProgress: boolean;
	contentEl: StubEl;
	rejectSingleItem(item: UnifiedItem): Promise<void>;
	rejectAll(): Promise<void>;
	acceptAll(): Promise<void>;
	renderTitleCard(container: StubEl, proposal: TitleProposal): void;
	renderTitleReview(proposal: TitleProposal): void;
}

// --- Helpers ----------------------------------------------------------------

/** Stub WorkspaceLeaf that satisfies ItemView constructor. */
function mockLeaf(): WorkspaceLeaf {
	return { view: {} } as unknown as WorkspaceLeaf;
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
		onTitleAccept: vi.fn().mockResolvedValue(undefined),
		onTitleReject: vi.fn().mockResolvedValue(undefined),
		onRemAcceptSelected: vi.fn().mockResolvedValue(undefined),
		onRemReject: vi.fn().mockResolvedValue(undefined),
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
		},
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
		},
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
		},
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
		},
	};
}

/** Minimal title proposal; pass a vault path to simulate a filename collision. */
function makeTitleProposal(conflictsWith?: string): TitleProposal {
	return {
		id: 'title-1',
		sourceNotePath: 'notes/test.md',
		currentTitle: 'Untitled',
		proposedTitle: 'Q3 Plan',
		trigger: 'untitled',
		reasoning: 'AI suggests a clearer title.',
		createdAt: '2024-01-01T00:00:00Z',
		status: 'pending',
		...(conflictsWith ? { conflictsWith } : {}),
	};
}

// DOM-assertion harness mirroring changelog.test.ts: the centralized obsidian
// mock faithfully tracks `cls`/`text` on createEl-built elements, so walking the
// tree by class/tag and reading textContent are reliable here (plain DOM, not a
// Notice — the inner-element gotcha does not apply).

/** Recursively collect every element in a createEl() stub tree. */
function walkEls(el: StubEl, out: StubEl[] = []): StubEl[] {
	for (const child of el.children as unknown as StubEl[]) {
		out.push(child);
		walkEls(child, out);
	}
	return out;
}
// Split on className rather than classList.contains(): the obsidian mock stores
// a multi-class `cls` string (e.g. "synapse-badge synapse-badge--conflict") as a
// single combined entry, so contains() of an individual token misses. className
// rejoins+splits cleanly and works for single- and multi-class elements alike.
const elsWithClass = (root: StubEl, cls: string): StubEl[] =>
	walkEls(root).filter((e) => e.className.split(/\s+/).includes(cls));
const elsWithTag = (root: StubEl, tag: string): StubEl[] =>
	walkEls(root).filter((e) => e.tagName === tag);
/** Concatenate an element's own text with all descendant text. */
const textOf = (el: StubEl): string =>
	[el.textContent ?? '', ...walkEls(el).map((c) => c.textContent ?? '')].join(' ');

// --- Tests ------------------------------------------------------------------

/** Create a deeply-recursive stub DOM element that supports all Obsidian HTML methods. */
function stubEl(): StubEl {
	const el = {
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
	return el as unknown as StubEl;
}

describe('UnifiedProposalView reject-all', () => {
	let view: ViewInternals; // boundary cast to reach private methods
	let callbacks: UnifiedViewCallbacks;

	beforeEach(() => {
		callbacks = mockCallbacks();
		view = new UnifiedProposalView(
			mockLeaf(),
			callbacks,
			new NotificationManager()
		) as unknown as ViewInternals;
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
			vi.mocked(callbacks.onElaborationReject).mockImplementation((id: string) => {
				callOrder.push(`elab-${id}`);
				return Promise.resolve();
			});
			vi.mocked(callbacks.onEnrichmentReject).mockImplementation((id: string) => {
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
			vi.mocked(callbacks.onEnrichmentReject).mockRejectedValue(new Error('network'));

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
			vi.mocked(callbacks.onElaborationReject).mockRejectedValue(new Error('fail'));
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

describe('UnifiedProposalView title collision UI (#414)', () => {
	/** Fresh view; boundary cast to reach the private render methods. */
	function makeView(): ViewInternals {
		return new UnifiedProposalView(
			mockLeaf(),
			mockCallbacks(),
			new NotificationManager()
		) as unknown as ViewInternals;
	}

	describe('renderTitleCard', () => {
		it('shows one conflict callout + Conflict badge (Title badge kept) when conflictsWith is set', () => {
			const container = createEl();
			makeView().renderTitleCard(container, makeTitleProposal('Projects/Roadmap.md'));

			const callouts = elsWithClass(container, 'synapse-title-conflict');
			expect(callouts).toHaveLength(1);
			expect(elsWithClass(container, 'synapse-badge--conflict')).toHaveLength(1);
			// The proposal kind stays legible: the Title badge is still present.
			expect(elsWithClass(container, 'synapse-badge--title')).toHaveLength(1);

			const text = textOf(callouts[0]);
			expect(text).toContain('Roadmap'); // existing note name (derived from conflictsWith)
			expect(text).toContain('Projects'); // its folder
			expect(text).toContain('trash'); // merge is destructive
		});

		it('shows no conflict UI and a plain Accept button when conflictsWith is unset', () => {
			const container = createEl();
			makeView().renderTitleCard(container, makeTitleProposal());

			expect(elsWithClass(container, 'synapse-title-conflict')).toHaveLength(0);
			expect(elsWithClass(container, 'synapse-badge--conflict')).toHaveLength(0);
			const buttons = elsWithTag(container, 'BUTTON').map((b) => b.textContent);
			expect(buttons).toContain('Accept');
		});
	});

	describe('renderTitleReview', () => {
		it('shows one conflict callout + Conflict header badge when conflictsWith is set', () => {
			const view = makeView();
			view.contentEl = createEl();
			view.renderTitleReview(makeTitleProposal('Projects/Roadmap.md'));
			const { contentEl } = view;

			const callouts = elsWithClass(contentEl, 'synapse-title-conflict');
			expect(callouts).toHaveLength(1);
			expect(elsWithClass(contentEl, 'synapse-badge--conflict')).toHaveLength(1);

			const text = textOf(callouts[0]);
			expect(text).toContain('Roadmap');
			expect(text).toContain('Projects');
			expect(text).toContain('trash');
		});

		it('shows no conflict UI and a plain Accept button when conflictsWith is unset', () => {
			const view = makeView();
			view.contentEl = createEl();
			view.renderTitleReview(makeTitleProposal());
			const { contentEl } = view;

			expect(elsWithClass(contentEl, 'synapse-title-conflict')).toHaveLength(0);
			expect(elsWithClass(contentEl, 'synapse-badge--conflict')).toHaveLength(0);
			const buttons = elsWithTag(contentEl, 'BUTTON').map((b) => b.textContent);
			expect(buttons).toContain('Accept');
		});
	});
});
