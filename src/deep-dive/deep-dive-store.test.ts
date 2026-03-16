import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeepDiveStore } from './deep-dive-store';
import { DeepDiveProposal, DeepDiveRun } from './types';

// ── Mock Obsidian ──
const mockFiles = new Map<string, string>();

const mockAdapter = {
	write: vi.fn(async (path: string, content: string) => {
		mockFiles.set(path, content);
	}),
	read: vi.fn(async (path: string) => {
		const content = mockFiles.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		return content;
	}),
	exists: vi.fn(async (path: string) => {
		// Check if path exists as a file or as a prefix of any file (folder check)
		if (mockFiles.has(path)) return true;
		for (const key of mockFiles.keys()) {
			if (key.startsWith(path + '/')) return true;
		}
		return false;
	}),
	remove: vi.fn(async (path: string) => {
		mockFiles.delete(path);
	}),
	list: vi.fn(async (folder: string) => {
		const normalized = folder.replace(/\\/g, '/').replace(/\/+/g, '/');
		const files = [...mockFiles.keys()].filter(
			f => f.startsWith(normalized + '/') && !f.slice(normalized.length + 1).includes('/')
		);
		return { files, folders: [] };
	}),
};

const mockVault = {
	adapter: mockAdapter,
	getAbstractFileByPath: vi.fn(() => null),
	createFolder: vi.fn(),
};

const mockApp = { vault: mockVault } as unknown as import('obsidian').App;
const getSettings = () => ({
	deepDive: {
		proposalFolderPath: '.auto-notes/deep-dive',
	},
}) as unknown as import('../settings').AutoNotesSettings;

function makeProposal(overrides: Partial<DeepDiveProposal> = {}): DeepDiveProposal {
	return {
		id: 'test-id-1',
		runId: 'run-1',
		sourceNotePath: 'notes/root.md',
		topic: {
			title: 'Test Topic',
			description: 'A test topic',
			relevance: 0.8,
			existsInVault: false,
			relatedUrls: [],
		},
		proposedPath: 'notes/Test Topic.md',
		proposedContent: '# Content',
		depth: 0,
		qualityScore: {
			score: 0.75,
			topicCount: 3,
			wordCount: 250,
			isTooGeneric: false,
			hasHighOverlap: false,
			reasoning: 'Good quality',
		},
		childProposalIds: [],
		createdAt: '2026-03-16T00:00:00.000Z',
		status: 'pending',
		...overrides,
	};
}

describe('DeepDiveStore', () => {
	let store: DeepDiveStore;

	beforeEach(() => {
		mockFiles.clear();
		vi.clearAllMocks();
		store = new DeepDiveStore(mockApp, getSettings);
	});

	describe('saveProposal / loadProposal', () => {
		it('saves and loads a proposal by id', async () => {
			const proposal = makeProposal();
			await store.saveProposal(proposal);

			const loaded = await store.loadProposal('test-id-1');
			expect(loaded).not.toBeNull();
			expect(loaded!.id).toBe('test-id-1');
			expect(loaded!.topic.title).toBe('Test Topic');
		});

		it('returns null for non-existent id', async () => {
			const loaded = await store.loadProposal('no-such-id');
			expect(loaded).toBeNull();
		});
	});

	describe('loadPendingProposals', () => {
		it('returns only pending proposals', async () => {
			await store.saveProposal(makeProposal({ id: 'p1', status: 'pending' }));
			await store.saveProposal(makeProposal({ id: 'p2', status: 'accepted' }));
			await store.saveProposal(makeProposal({ id: 'p3', status: 'pending' }));

			const pending = await store.loadPendingProposals();
			expect(pending.length).toBe(2);
			expect(pending.map(p => p.id).sort()).toEqual(['p1', 'p3']);
		});
	});

	describe('updateProposalStatus', () => {
		it('updates the status of a proposal', async () => {
			await store.saveProposal(makeProposal());
			await store.updateProposalStatus('test-id-1', 'accepted');

			const loaded = await store.loadProposal('test-id-1');
			expect(loaded!.status).toBe('accepted');
		});
	});

	describe('deleteProposal', () => {
		it('removes a proposal', async () => {
			await store.saveProposal(makeProposal());
			await store.deleteProposal('test-id-1');

			const loaded = await store.loadProposal('test-id-1');
			expect(loaded).toBeNull();
		});
	});

	describe('cascadeReject', () => {
		it('rejects a proposal and all its children', async () => {
			await store.saveProposal(makeProposal({
				id: 'parent',
				childProposalIds: ['child-1', 'child-2'],
			}));
			await store.saveProposal(makeProposal({
				id: 'child-1',
				childProposalIds: ['grandchild'],
			}));
			await store.saveProposal(makeProposal({
				id: 'child-2',
				childProposalIds: [],
			}));
			await store.saveProposal(makeProposal({
				id: 'grandchild',
				childProposalIds: [],
			}));

			const rejected = await store.cascadeReject('parent');
			expect(rejected.sort()).toEqual(['child-1', 'child-2', 'grandchild', 'parent']);

			const parent = await store.loadProposal('parent');
			expect(parent!.status).toBe('rejected');

			const grandchild = await store.loadProposal('grandchild');
			expect(grandchild!.status).toBe('rejected');
		});

		it('returns empty array for non-existent id', async () => {
			const rejected = await store.cascadeReject('no-such-id');
			expect(rejected).toEqual([]);
		});
	});

	describe('deleteAllProposals', () => {
		it('removes all proposals', async () => {
			await store.saveProposal(makeProposal({ id: 'p1' }));
			await store.saveProposal(makeProposal({ id: 'p2' }));

			await store.deleteAllProposals();

			const all = await store.loadAllProposals();
			expect(all.length).toBe(0);
		});
	});

	describe('saveRun / loadRun', () => {
		it('saves and loads a run', async () => {
			const run: DeepDiveRun = {
				id: 'run-1',
				rootNotePath: 'notes/root.md',
				maxDepth: 3,
				qualityThreshold: 0.4,
				proposalIds: ['p1', 'p2'],
				stats: { totalProposals: 2, byDepth: { 0: 2 }, earlyTerminations: 0 },
				createdAt: '2026-03-16T00:00:00.000Z',
				status: 'completed',
			};

			await store.saveRun(run);
			const loaded = await store.loadRun('run-1');
			expect(loaded).not.toBeNull();
			expect(loaded!.rootNotePath).toBe('notes/root.md');
			expect(loaded!.stats.totalProposals).toBe(2);
		});

		it('returns null for non-existent run', async () => {
			const loaded = await store.loadRun('no-such-run');
			expect(loaded).toBeNull();
		});
	});
});
