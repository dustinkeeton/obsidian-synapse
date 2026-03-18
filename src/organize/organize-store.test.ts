import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizeStore } from './organize-store';
import { OrganizeProposal, OrganizeSnapshot } from './types';
import { DEFAULT_SETTINGS } from '../settings';

function makeProposal(overrides: Partial<OrganizeProposal> = {}): OrganizeProposal {
	return {
		id: 'test-id-12345678',
		sourceNotePath: 'inbox/test.md',
		proposedDirectory: 'machine-learning',
		reasoning: 'Note is about machine learning',
		createdAt: '2026-03-16T00:00:00.000Z',
		status: 'pending',
		...overrides,
	};
}

function makeSnapshot(overrides: Partial<OrganizeSnapshot> = {}): OrganizeSnapshot {
	return {
		id: 'snap-12345678',
		currentPath: 'machine-learning/test.md',
		originalPath: 'inbox/test.md',
		movedAt: '2026-03-16T00:00:00.000Z',
		...overrides,
	};
}

describe('OrganizeStore', () => {
	let store: OrganizeStore;
	let mockAdapter: any;

	beforeEach(() => {
		mockAdapter = {
			read: vi.fn(),
			write: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(true),
			remove: vi.fn().mockResolvedValue(undefined),
			list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
		};

		const app = {
			vault: {
				adapter: mockAdapter,
				createFolder: vi.fn().mockResolvedValue(undefined),
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
			},
		} as any;

		const getSettings = () => structuredClone(DEFAULT_SETTINGS);
		store = new OrganizeStore(app, getSettings);
	});

	// ── Proposals ──

	describe('proposal CRUD', () => {
		it('saves a proposal as JSON', async () => {
			const proposal = makeProposal();
			await store.saveProposal(proposal);

			expect(mockAdapter.write).toHaveBeenCalledOnce();
			const [path, content] = mockAdapter.write.mock.calls[0];
			expect(path).toContain('organize-');
			expect(path.endsWith('.json')).toBe(true);
			expect(JSON.parse(content)).toEqual(proposal);
		});

		it('loads a proposal by id', async () => {
			const proposal = makeProposal({ id: 'find-me-123' });
			mockAdapter.list.mockResolvedValue({
				files: ['.synapse/organize/proposals/test.json'],
				folders: [],
			});
			mockAdapter.read.mockResolvedValue(JSON.stringify(proposal));

			const loaded = await store.loadProposal('find-me-123');
			expect(loaded).toEqual(proposal);
		});

		it('returns null for missing proposal', async () => {
			mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
			const loaded = await store.loadProposal('nonexistent');
			expect(loaded).toBeNull();
		});

		it('loads only pending proposals', async () => {
			const pending = makeProposal({ id: 'p1', status: 'pending' });
			const accepted = makeProposal({ id: 'p2', status: 'accepted' });

			mockAdapter.list.mockResolvedValue({
				files: ['a.json', 'b.json'],
				folders: [],
			});
			mockAdapter.read
				.mockResolvedValueOnce(JSON.stringify(pending))
				.mockResolvedValueOnce(JSON.stringify(accepted));

			const result = await store.loadPendingProposals();
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('p1');
		});

		it('updates proposal status', async () => {
			const proposal = makeProposal({ id: 'update-me' });
			mockAdapter.list.mockResolvedValue({
				files: ['a.json'],
				folders: [],
			});
			mockAdapter.read.mockResolvedValue(JSON.stringify(proposal));

			await store.updateProposalStatus('update-me', 'accepted');

			expect(mockAdapter.write).toHaveBeenCalled();
			const written = JSON.parse(mockAdapter.write.mock.calls[0][1]);
			expect(written.status).toBe('accepted');
		});

		it('deletes a proposal by id', async () => {
			const proposal = makeProposal({ id: 'delete-me' });
			mockAdapter.list.mockResolvedValue({
				files: ['.synapse/organize/proposals/test.json'],
				folders: [],
			});
			mockAdapter.read.mockResolvedValue(JSON.stringify(proposal));

			await store.deleteProposal('delete-me');
			expect(mockAdapter.remove).toHaveBeenCalledOnce();
		});

		it('handles empty folder gracefully', async () => {
			mockAdapter.exists.mockResolvedValue(false);
			const result = await store.loadAllProposals();
			expect(result).toEqual([]);
		});
	});

	// ── Snapshots ──

	describe('snapshot CRUD', () => {
		it('saves a snapshot', async () => {
			const snapshot = makeSnapshot();
			await store.saveSnapshot(snapshot);

			expect(mockAdapter.write).toHaveBeenCalledOnce();
			const [path, content] = mockAdapter.write.mock.calls[0];
			expect(path).toContain('.json');
			expect(JSON.parse(content)).toEqual(snapshot);
		});

		it('loads a snapshot by current path', async () => {
			const snapshot = makeSnapshot();
			mockAdapter.exists.mockResolvedValue(true);
			mockAdapter.read.mockResolvedValue(JSON.stringify(snapshot));

			const loaded = await store.loadSnapshot('machine-learning/test.md');
			expect(loaded).toEqual(snapshot);
		});

		it('returns null when no snapshot exists', async () => {
			mockAdapter.exists.mockResolvedValue(false);
			const loaded = await store.loadSnapshot('nonexistent/path.md');
			expect(loaded).toBeNull();
		});

		it('removes a snapshot', async () => {
			mockAdapter.exists.mockResolvedValue(true);
			await store.removeSnapshot('machine-learning/test.md');
			expect(mockAdapter.remove).toHaveBeenCalledOnce();
		});

		it('handles remove when snapshot does not exist', async () => {
			mockAdapter.exists.mockResolvedValue(false);
			// Should not throw
			await store.removeSnapshot('nonexistent/path.md');
			expect(mockAdapter.remove).not.toHaveBeenCalled();
		});
	});
});
