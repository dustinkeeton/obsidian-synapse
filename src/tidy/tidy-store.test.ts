import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TidyStore } from './tidy-store';
import { TidySnapshot } from './types';
import { DEFAULT_SETTINGS } from '../settings';
import { TFile } from '../__mocks__/obsidian';

function makeSnapshot(overrides: Partial<TidySnapshot> = {}): TidySnapshot {
	return {
		id: 'snap-12345678',
		filePath: 'notes/test.md',
		originalContent: '# Test\n\nSome contnt with typos.',
		createdAt: '2026-03-13T00:00:00.000Z',
		...overrides,
	};
}

describe('TidyStore', () => {
	let store: TidyStore;
	let mockAdapter: any;
	let mockVault: any;

	beforeEach(() => {
		mockAdapter = {
			write: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(true),
		};

		mockVault = {
			adapter: mockAdapter,
			createFolder: vi.fn().mockResolvedValue(undefined),
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			read: vi.fn().mockResolvedValue(''),
			delete: vi.fn().mockResolvedValue(undefined),
		};

		const app = { vault: mockVault } as any;
		const getSettings = () => ({ ...DEFAULT_SETTINGS });
		store = new TidyStore(app, getSettings);
	});

	it('saves a snapshot using adapter.write (upsert)', async () => {
		const snapshot = makeSnapshot();
		await store.save(snapshot);

		expect(mockAdapter.write).toHaveBeenCalledOnce();
		const [path, content] = mockAdapter.write.mock.calls[0];
		expect(path).toContain('.synapse/tidy-snapshots/');
		expect(path.endsWith('.json')).toBe(true);
		expect(JSON.parse(content)).toEqual(snapshot);
	});

	it('overwrites existing snapshot for the same file', async () => {
		const snap1 = makeSnapshot({ id: 'first', originalContent: 'v1' });
		const snap2 = makeSnapshot({ id: 'second', originalContent: 'v2' });

		await store.save(snap1);
		await store.save(snap2);

		// Both writes go to the same path
		const paths = mockAdapter.write.mock.calls.map((c: any) => c[0]);
		expect(paths[0]).toBe(paths[1]);

		// Second write has the updated content
		const written = JSON.parse(mockAdapter.write.mock.calls[1][1]);
		expect(written.id).toBe('second');
		expect(written.originalContent).toBe('v2');
	});

	it('derives deterministic path from file path', async () => {
		const snap1 = makeSnapshot({ filePath: 'folder/sub/note.md' });
		const snap2 = makeSnapshot({ filePath: 'folder/sub/note.md' });

		await store.save(snap1);
		await store.save(snap2);

		const path1 = mockAdapter.write.mock.calls[0][0];
		const path2 = mockAdapter.write.mock.calls[1][0];
		expect(path1).toBe(path2);
	});

	it('uses different paths for different notes', async () => {
		await store.save(makeSnapshot({ filePath: 'notes/a.md' }));
		await store.save(makeSnapshot({ filePath: 'notes/b.md' }));

		const path1 = mockAdapter.write.mock.calls[0][0];
		const path2 = mockAdapter.write.mock.calls[1][0];
		expect(path1).not.toBe(path2);
	});

	it('loads a snapshot when file exists', async () => {
		const snapshot = makeSnapshot();
		const mockFile = new TFile('snap.json');
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);
		mockVault.read.mockResolvedValue(JSON.stringify(snapshot));

		const loaded = await store.load('notes/test.md');
		expect(loaded).toEqual(snapshot);
	});

	it('returns null when no snapshot exists', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		const loaded = await store.load('notes/nonexistent.md');
		expect(loaded).toBeNull();
	});

	it('removes a snapshot when file exists', async () => {
		const mockFile = new TFile('snap.json');
		mockVault.getAbstractFileByPath.mockReturnValue(mockFile);

		await store.remove('notes/test.md');
		expect(mockVault.delete).toHaveBeenCalledWith(mockFile);
	});

	it('does nothing when removing a nonexistent snapshot', async () => {
		mockVault.getAbstractFileByPath.mockReturnValue(null);
		await store.remove('notes/nonexistent.md');
		expect(mockVault.delete).not.toHaveBeenCalled();
	});

	it('sanitizes slashes in file paths for snapshot filename', async () => {
		await store.save(makeSnapshot({ filePath: 'deep/nested/path/note.md' }));
		const path = mockAdapter.write.mock.calls[0][0] as string;
		const fileName = path.split('/').pop()!;
		// No slashes in the filename itself
		expect(fileName).not.toContain('/');
		expect(fileName).toContain('deep__nested__path__note');
	});
});
