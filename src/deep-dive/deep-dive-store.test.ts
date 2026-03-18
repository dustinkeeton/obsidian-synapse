import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import { DeepDiveStore } from './deep-dive-store';
import { buildDeepDivePath } from './index';
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
		proposalFolderPath: '.synapse/deep-dive',
	},
}) as unknown as import('../settings').SynapseSettings;

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

	describe('loadProposalsByRunId', () => {
		it('returns only proposals matching the run ID', async () => {
			await store.saveProposal(makeProposal({ id: 'p1', runId: 'run-1' }));
			await store.saveProposal(makeProposal({ id: 'p2', runId: 'run-1' }));
			await store.saveProposal(makeProposal({ id: 'p3', runId: 'run-2' }));

			const run1Proposals = await store.loadProposalsByRunId('run-1');
			expect(run1Proposals.length).toBe(2);
			expect(run1Proposals.map(p => p.id).sort()).toEqual(['p1', 'p2']);
		});

		it('returns empty array when no proposals match', async () => {
			await store.saveProposal(makeProposal({ id: 'p1', runId: 'run-1' }));
			const result = await store.loadProposalsByRunId('no-such-run');
			expect(result).toEqual([]);
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

	describe('buildDeepDivePath', () => {
		function makeRootFile(path: string, parentPath?: string): TFile {
			const file = { path, basename: path.split('/').pop()?.replace(/\.[^.]+$/, '') || '', parent: null } as TFile;
			if (parentPath !== undefined) {
				file.parent = { path: parentPath } as TFolder;
			}
			return file;
		}

		describe('flat mode', () => {
			it('uses per-root subfolder with default setting', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath('Neural Networks', root, { noteOutputFolder: 'Deep Dives', nestingMode: 'flat' });
				expect(result).toBe('Deep Dives/Machine Learning/Neural Networks.md');
			});

			it('uses per-root subfolder with custom output folder', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath('Neural Networks', root, { noteOutputFolder: 'Custom Folder', nestingMode: 'flat' });
				expect(result).toBe('Custom Folder/Machine Learning/Neural Networks.md');
			});

			it('falls back to source folder when output folder is empty', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath('Neural Networks', root, { noteOutputFolder: '', nestingMode: 'flat' });
				expect(result).toBe('notes/Neural Networks.md');
			});

			it('falls back to vault root when output folder is empty and source has no parent', () => {
				const root = makeRootFile('Machine Learning.md');
				const result = buildDeepDivePath('Neural Networks', root, { noteOutputFolder: '', nestingMode: 'flat' });
				expect(result).toBe('Neural Networks.md');
			});

			it('ignores parentProposedPath in flat mode', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath(
					'Backpropagation',
					root,
					{ noteOutputFolder: 'Deep Dives', nestingMode: 'flat' },
					'Deep Dives/Machine Learning/Neural Networks.md'
				);
				expect(result).toBe('Deep Dives/Machine Learning/Backpropagation.md');
			});
		});

		describe('nested mode', () => {
			it('places root-level topics in per-root subfolder (no parent)', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath('Neural Networks', root, { noteOutputFolder: 'Deep Dives', nestingMode: 'nested' });
				expect(result).toBe('Deep Dives/Machine Learning/Neural Networks.md');
			});

			it('nests child topics under parent topic subfolder', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath(
					'Backpropagation',
					root,
					{ noteOutputFolder: 'Deep Dives', nestingMode: 'nested' },
					'Deep Dives/Machine Learning/Neural Networks.md'
				);
				expect(result).toBe('Deep Dives/Machine Learning/Neural Networks/Backpropagation.md');
			});

			it('nests grandchild topics under child topic subfolder', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath(
					'Learning Rate Schedules',
					root,
					{ noteOutputFolder: 'Deep Dives', nestingMode: 'nested' },
					'Deep Dives/Machine Learning/Gradient Descent.md'
				);
				expect(result).toBe('Deep Dives/Machine Learning/Gradient Descent/Learning Rate Schedules.md');
			});

			it('handles deeply nested paths (3+ levels)', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath(
					'Cosine Annealing',
					root,
					{ noteOutputFolder: 'Deep Dives', nestingMode: 'nested' },
					'Deep Dives/Machine Learning/Gradient Descent/Learning Rate Schedules.md'
				);
				expect(result).toBe('Deep Dives/Machine Learning/Gradient Descent/Learning Rate Schedules/Cosine Annealing.md');
			});
		});

		describe('defaults and edge cases', () => {
			it('defaults to nested mode when nestingMode is not set', () => {
				const root = makeRootFile('notes/Machine Learning.md', 'notes');
				const result = buildDeepDivePath(
					'Backpropagation',
					root,
					{ noteOutputFolder: 'Deep Dives' },
					'Deep Dives/Machine Learning/Neural Networks.md'
				);
				expect(result).toBe('Deep Dives/Machine Learning/Neural Networks/Backpropagation.md');
			});

			it('sanitizes special characters in topic title', () => {
				const root = makeRootFile('notes/Root.md', 'notes');
				const result = buildDeepDivePath('What is AI? A "Deep" Look', root, { noteOutputFolder: 'Deep Dives', nestingMode: 'nested' });
				expect(result).toBe('Deep Dives/Root/What is AI- A -Deep- Look.md');
			});

			it('sanitizes special characters in nested paths', () => {
				const root = makeRootFile('notes/Root.md', 'notes');
				const result = buildDeepDivePath(
					'What is "Neural"?',
					root,
					{ noteOutputFolder: 'Deep Dives', nestingMode: 'nested' },
					'Deep Dives/Root/AI Overview.md'
				);
				expect(result).toBe('Deep Dives/Root/AI Overview/What is -Neural--.md');
			});
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
