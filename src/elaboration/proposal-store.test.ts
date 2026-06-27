import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProposalStore } from './proposal-store';
import { Proposal } from './types';
import { DEFAULT_SETTINGS } from '../settings';

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
	return {
		id: 'test-id-12345678',
		sourceNotePath: 'notes/test.md',
		createdAt: '2026-03-13T00:00:00.000Z',
		detectionReasons: [{ type: 'short-note', wordCount: 10 }],
		originalContent: '# Test\n\nShort note.',
		proposedAdditions: 'Some AI-generated additions.',
		insertionPoint: 'append',
		status: 'pending',
		...overrides,
	};
}

describe('ProposalStore', () => {
	let store: ProposalStore;
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

		const getSettings = () => ({ ...DEFAULT_SETTINGS });
		store = new ProposalStore(app, getSettings);
	});

	it('saves a proposal as JSON', async () => {
		const proposal = makeProposal();
		await store.save(proposal);

		expect(mockAdapter.write).toHaveBeenCalledOnce();
		const [path, content] = mockAdapter.write.mock.calls[0];
		expect(path.endsWith('.json')).toBe(true);
		expect(JSON.parse(content)).toEqual(proposal);
	});

	it('ensures folder exists before saving', async () => {
		const createFolder = vi.fn().mockResolvedValue(undefined);
		const app = {
			vault: {
				adapter: mockAdapter,
				createFolder,
				// Return null so ensureFolder thinks the folder doesn't exist
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
			},
		} as any;

		const freshStore = new ProposalStore(app, () => ({ ...DEFAULT_SETTINGS }));
		await freshStore.save(makeProposal());

		expect(createFolder).toHaveBeenCalled();
	});

	it('loads a proposal by id', async () => {
		const proposal = makeProposal({ id: 'find-me-123' });
		mockAdapter.list.mockResolvedValue({
			files: ['.synapse/proposals/test-find-me-1.json'],
			folders: [],
		});
		mockAdapter.read.mockResolvedValue(JSON.stringify(proposal));

		const loaded = await store.load('find-me-123');
		expect(loaded).toEqual(proposal);
	});

	it('returns null for missing proposal', async () => {
		mockAdapter.list.mockResolvedValue({ files: [], folders: [] });
		const loaded = await store.load('nonexistent');
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

		const result = await store.loadPending();
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('p1');
	});

	it('loadByNote returns only proposals whose sourceNotePath matches exactly', async () => {
		const a1 = makeProposal({ id: 'a1', sourceNotePath: 'notes/a.md' });
		const a2 = makeProposal({ id: 'a2', sourceNotePath: 'notes/a.md' });
		const b1 = makeProposal({ id: 'b1', sourceNotePath: 'notes/b.md' });

		mockAdapter.list.mockResolvedValue({
			files: ['a1.json', 'a2.json', 'b1.json'],
			folders: [],
		});
		mockAdapter.read
			.mockResolvedValueOnce(JSON.stringify(a1))
			.mockResolvedValueOnce(JSON.stringify(a2))
			.mockResolvedValueOnce(JSON.stringify(b1));

		const result = await store.loadByNote('notes/a.md');
		expect(result.map(p => p.id).sort()).toEqual(['a1', 'a2']);
	});

	it('loadByNote does not prefix-match a different note that shares a name stem', async () => {
		// 'notes/a.md' must not match 'notes/a-extra.md' — exact path only.
		const a = makeProposal({ id: 'a', sourceNotePath: 'notes/a.md' });
		const aExtra = makeProposal({ id: 'a-extra', sourceNotePath: 'notes/a-extra.md' });

		mockAdapter.list.mockResolvedValue({ files: ['a.json', 'extra.json'], folders: [] });
		mockAdapter.read
			.mockResolvedValueOnce(JSON.stringify(a))
			.mockResolvedValueOnce(JSON.stringify(aExtra));

		const result = await store.loadByNote('notes/a.md');
		expect(result.map(p => p.id)).toEqual(['a']);
	});

	it('still loads legacy proposals that predate the contentKey field', async () => {
		// makeProposal omits contentKey; isProposal must keep accepting it so old
		// proposal files continue to load.
		const legacy = makeProposal({ id: 'legacy-1' });
		expect('contentKey' in legacy).toBe(false);
		mockAdapter.list.mockResolvedValue({ files: ['legacy.json'], folders: [] });
		mockAdapter.read.mockResolvedValue(JSON.stringify(legacy));

		const result = await store.loadAll();
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('legacy-1');
		expect(result[0].contentKey).toBeUndefined();
	});

	it('loads all proposals including rejected', async () => {
		const p1 = makeProposal({ id: 'p1', status: 'pending' });
		const p2 = makeProposal({ id: 'p2', status: 'rejected' });

		mockAdapter.list.mockResolvedValue({
			files: ['a.json', 'b.json'],
			folders: [],
		});
		mockAdapter.read
			.mockResolvedValueOnce(JSON.stringify(p1))
			.mockResolvedValueOnce(JSON.stringify(p2));

		const result = await store.loadAll();
		expect(result).toHaveLength(2);
	});

	it('updates proposal status', async () => {
		const proposal = makeProposal({ id: 'update-me' });
		mockAdapter.list.mockResolvedValue({
			files: ['a.json'],
			folders: [],
		});
		mockAdapter.read.mockResolvedValue(JSON.stringify(proposal));

		await store.updateStatus('update-me', 'accepted');

		expect(mockAdapter.write).toHaveBeenCalled();
		const written = JSON.parse(mockAdapter.write.mock.calls[0][1]);
		expect(written.status).toBe('accepted');
	});

	it('deletes a proposal by id', async () => {
		const proposal = makeProposal({ id: 'delete-me' });
		mockAdapter.list.mockResolvedValue({
			files: ['.synapse/proposals/test.json'],
			folders: [],
		});
		mockAdapter.read.mockResolvedValue(JSON.stringify(proposal));

		await store.delete('delete-me');
		expect(mockAdapter.remove).toHaveBeenCalledOnce();
	});

	it('handles empty folder gracefully', async () => {
		mockAdapter.exists.mockResolvedValue(false);
		const result = await store.loadAll();
		expect(result).toEqual([]);
	});

	it('skips invalid JSON files during loadAll', async () => {
		mockAdapter.list.mockResolvedValue({
			files: ['good.json', 'bad.json'],
			folders: [],
		});
		mockAdapter.read
			.mockResolvedValueOnce(JSON.stringify(makeProposal({ id: 'good' })))
			.mockResolvedValueOnce('not valid json {{{');

		const result = await store.loadAll();
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('good');
	});
});
