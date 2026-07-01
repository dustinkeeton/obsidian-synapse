import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { TitleProposalStore } from './title-store';
import { TitleProposal } from './types';
import { DEFAULT_SETTINGS } from '../settings';
import type { App } from 'obsidian';

/** Spy-backed stand-in for the Vault adapter surface the store reads/writes through. */
interface MockAdapter {
	read: Mock<(path: string) => Promise<string>>;
	write: Mock<(path: string, data: string) => Promise<void>>;
	exists: Mock<(path: string) => Promise<boolean>>;
	remove: Mock<(path: string) => Promise<void>>;
	list: Mock<(path: string) => Promise<{ files: string[]; folders: string[] }>>;
}

function makeProposal(overrides: Partial<TitleProposal> = {}): TitleProposal {
	return {
		id: 'test-id-12345678',
		sourceNotePath: 'notes/Untitled.md',
		currentTitle: 'Untitled',
		proposedTitle: 'Meeting Notes From Monday',
		trigger: 'untitled',
		reasoning: 'Note contains meeting notes from a Monday standup',
		createdAt: '2026-03-18T00:00:00.000Z',
		status: 'pending',
		...overrides,
	};
}

describe('TitleProposalStore', () => {
	let store: TitleProposalStore;
	let mockAdapter: MockAdapter;

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
		} as unknown as App;

		const getSettings = () => ({ ...DEFAULT_SETTINGS });
		store = new TitleProposalStore(app, getSettings);
	});

	it('saves a proposal as JSON', async () => {
		const proposal = makeProposal();
		await store.save(proposal);

		expect(mockAdapter.write).toHaveBeenCalledOnce();
		const [path, content] = mockAdapter.write.mock.calls[0];
		expect(path.endsWith('.json')).toBe(true);
		expect(path).toContain('-title-');
		expect(JSON.parse(content)).toEqual(proposal);
	});

	it('loads a proposal by id', async () => {
		const proposal = makeProposal({ id: 'find-me-123' });
		mockAdapter.list.mockResolvedValue({
			files: ['.synapse/title-proposals/test-title-find-me-1.json'],
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

	it('loads proposals for a specific note', async () => {
		const p1 = makeProposal({ id: 'p1', sourceNotePath: 'notes/A.md' });
		const p2 = makeProposal({ id: 'p2', sourceNotePath: 'notes/B.md' });

		mockAdapter.list.mockResolvedValue({
			files: ['a.json', 'b.json'],
			folders: [],
		});
		mockAdapter.read
			.mockResolvedValueOnce(JSON.stringify(p1))
			.mockResolvedValueOnce(JSON.stringify(p2));

		const result = await store.loadForNote('notes/A.md');
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

		await store.updateStatus('update-me', 'accepted');

		expect(mockAdapter.write).toHaveBeenCalled();
		const written = JSON.parse(mockAdapter.write.mock.calls[0][1]) as TitleProposal;
		expect(written.status).toBe('accepted');
	});

	it('deletes a proposal by id', async () => {
		const proposal = makeProposal({ id: 'delete-me' });
		mockAdapter.list.mockResolvedValue({
			files: ['.synapse/title-proposals/test.json'],
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
