import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { EnrichmentStore } from './enrichment-store';
import { EnrichmentProposal } from './types';
import { DEFAULT_SETTINGS } from '../settings';
import type { App } from 'obsidian';

/** Spy-backed stand-in for the vault DataAdapter the store persists through. */
interface MockAdapter {
	read: Mock<(path: string) => Promise<string>>;
	write: Mock<(path: string, data: string) => Promise<void>>;
	exists: Mock<(path: string) => Promise<boolean>>;
	remove: Mock<(path: string) => Promise<void>>;
	list: Mock<(path: string) => Promise<{ files: string[]; folders: string[] }>>;
}

function makeProposal(overrides: Partial<EnrichmentProposal> = {}): EnrichmentProposal {
	return {
		id: 'test-id-12345678',
		sourceNotePath: 'notes/test.md',
		createdAt: '2026-03-13T00:00:00.000Z',
		triggerSource: 'manual',
		result: {
			tags: [],
			internalLinks: [],
			externalLinks: [],
			frontmatter: [],
		},
		status: 'pending',
		...overrides,
	};
}

describe('EnrichmentStore', () => {
	let store: EnrichmentStore;
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
		store = new EnrichmentStore(app, getSettings);
	});

	it('saves a proposal as JSON', async () => {
		const proposal = makeProposal();
		await store.save(proposal);

		expect(mockAdapter.write).toHaveBeenCalledOnce();
		const [path, content] = mockAdapter.write.mock.calls[0];
		expect(path).toContain('enrich-');
		expect(path.endsWith('.json')).toBe(true);
		expect(JSON.parse(content)).toEqual(proposal);
	});

	it('loads a proposal by id', async () => {
		const proposal = makeProposal({ id: 'find-me-123' });
		mockAdapter.list.mockResolvedValue({
			files: ['.synapse/enrichments/test-enrich-find-me-1.json'],
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
		const p1 = makeProposal({ id: 'p1', sourceNotePath: 'target.md' });
		const p2 = makeProposal({ id: 'p2', sourceNotePath: 'other.md' });

		mockAdapter.list.mockResolvedValue({
			files: ['a.json', 'b.json'],
			folders: [],
		});
		mockAdapter.read
			.mockResolvedValueOnce(JSON.stringify(p1))
			.mockResolvedValueOnce(JSON.stringify(p2));

		const result = await store.loadForNote('target.md');
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

		await store.updateStatus('update-me', 'accepted', {
			tags: ['#test'],
			internalLinks: [],
			externalLinks: [],
			frontmatter: [],
		});

		expect(mockAdapter.write).toHaveBeenCalled();
		const written = JSON.parse(mockAdapter.write.mock.calls[0][1]) as EnrichmentProposal;
		expect(written.status).toBe('accepted');
		expect(written.acceptedItems!.tags).toEqual(['#test']);
	});

	it('deletes a proposal by id', async () => {
		const proposal = makeProposal({ id: 'delete-me' });
		mockAdapter.list.mockResolvedValue({
			files: ['.synapse/enrichments/test.json'],
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
});
