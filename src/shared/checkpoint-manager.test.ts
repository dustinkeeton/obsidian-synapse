import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CheckpointManager } from './checkpoint-manager';
import { Checkpoint, CheckpointWorkItem, DeferredTask } from './checkpoint-types';

// -- Mock Obsidian vault adapter --
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
			(f) =>
				f.startsWith(normalized + '/') &&
				!f.slice(normalized.length + 1).includes('/')
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

function makeItems(count: number): CheckpointWorkItem[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `item${i}`,
		label: `Item ${i}`,
		payload: { index: i },
	}));
}

function makeDeferredTask(id: string, type: string): DeferredTask {
	return { id, type, data: { taskId: id } };
}

describe('CheckpointManager', () => {
	let manager: CheckpointManager;

	beforeEach(() => {
		mockFiles.clear();
		vi.clearAllMocks();
		manager = new CheckpointManager(mockApp);
	});

	describe('create', () => {
		it('creates a checkpoint with all items in remainingItems', async () => {
			const items = makeItems(3);
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Deep dive into ML',
				items,
				metadata: { runId: 'run1' },
			});

			expect(cp.id).toBeTruthy();
			expect(cp.module).toBe('deep-dive');
			expect(cp.operationLabel).toBe('Deep dive into ML');
			expect(cp.status).toBe('active');
			expect(cp.remainingItems).toHaveLength(3);
			expect(cp.completedItems).toHaveLength(0);
			expect(cp.deferredTasks).toHaveLength(0);
			expect(cp.metadata).toEqual({ runId: 'run1' });
		});

		it('persists the checkpoint to disk', async () => {
			const cp = await manager.create({
				module: 'elaboration',
				operationLabel: 'Scan vault',
				items: makeItems(1),
			});

			const loaded = await manager.load(cp.id);
			expect(loaded).not.toBeNull();
			expect(loaded!.id).toBe(cp.id);
		});

		it('defaults metadata to empty object', async () => {
			const cp = await manager.create({
				module: 'enrichment',
				operationLabel: 'Enrich vault',
				items: [],
			});

			expect(cp.metadata).toEqual({});
		});
	});

	describe('completeItem', () => {
		it('moves an item from remaining to completed', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: makeItems(3),
			});

			const updated = await manager.completeItem(cp.id, 'item1');

			expect(updated).not.toBeNull();
			expect(updated!.remainingItems).toHaveLength(2);
			expect(updated!.completedItems).toHaveLength(1);
			expect(updated!.completedItems[0].id).toBe('item1');
		});

		it('returns checkpoint unchanged for non-existent item', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: makeItems(2),
			});

			const updated = await manager.completeItem(cp.id, 'nosuchitem');

			expect(updated!.remainingItems).toHaveLength(2);
			expect(updated!.completedItems).toHaveLength(0);
		});

		it('returns null for non-existent checkpoint', async () => {
			// Use a valid-format ID that does not exist
			const result = await manager.completeItem('nosuchcp', 'item0');
			expect(result).toBeNull();
		});

		it('returns null for non-active checkpoint', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: makeItems(1),
			});
			await manager.complete(cp.id);

			const result = await manager.completeItem(cp.id, 'item0');
			expect(result).toBeNull();
		});

		it('updates the updatedAt timestamp', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: makeItems(1),
			});
			const originalUpdatedAt = cp.updatedAt;

			// Small delay to ensure timestamp differs
			await new Promise((r) => setTimeout(r, 5));

			const updated = await manager.completeItem(cp.id, 'item0');
			expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
		});
	});

	describe('addDeferredTask', () => {
		it('adds a deferred task to the checkpoint', async () => {
			const cp = await manager.create({
				module: 'elaboration',
				operationLabel: 'Test',
				items: makeItems(1),
			});

			const task = makeDeferredTask('task1', 'enrich');
			const updated = await manager.addDeferredTask(cp.id, task);

			expect(updated!.deferredTasks).toHaveLength(1);
			expect(updated!.deferredTasks[0].id).toBe('task1');
		});

		it('returns null for non-existent checkpoint', async () => {
			const task = makeDeferredTask('task1', 'enrich');
			const result = await manager.addDeferredTask('nosuchcp', task);
			expect(result).toBeNull();
		});

		it('returns null for non-active checkpoint', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: [],
			});
			await manager.discard(cp.id);

			const task = makeDeferredTask('task1', 'enrich');
			const result = await manager.addDeferredTask(cp.id, task);
			expect(result).toBeNull();
		});
	});

	describe('complete', () => {
		it('marks checkpoint as completed and returns deferred tasks', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: makeItems(1),
			});

			const task = makeDeferredTask('task1', 'enrich');
			await manager.addDeferredTask(cp.id, task);

			const tasks = await manager.complete(cp.id);
			expect(tasks).toHaveLength(1);
			expect(tasks[0].id).toBe('task1');

			const loaded = await manager.load(cp.id);
			expect(loaded!.status).toBe('completed');
		});

		it('returns empty array for non-existent checkpoint', async () => {
			const tasks = await manager.complete('nosuchcp');
			expect(tasks).toEqual([]);
		});

		it('returns empty array for already completed checkpoint', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: [],
			});
			await manager.complete(cp.id);

			const tasks = await manager.complete(cp.id);
			expect(tasks).toEqual([]);
		});
	});

	describe('discard', () => {
		it('marks checkpoint as discarded', async () => {
			const cp = await manager.create({
				module: 'enrichment',
				operationLabel: 'Test',
				items: makeItems(2),
			});

			await manager.discard(cp.id);

			const loaded = await manager.load(cp.id);
			expect(loaded!.status).toBe('discarded');
		});

		it('no-ops for non-existent checkpoint', async () => {
			// Should not throw
			await manager.discard('nosuchcp');
		});
	});

	describe('remove', () => {
		it('deletes the checkpoint file', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: [],
			});

			await manager.remove(cp.id);

			const loaded = await manager.load(cp.id);
			expect(loaded).toBeNull();
		});

		it('no-ops for non-existent checkpoint', async () => {
			// Should not throw
			await manager.remove('nosuchcp');
		});
	});

	describe('resume', () => {
		it('returns the checkpoint with remaining items for active checkpoints', async () => {
			const items = makeItems(3);
			const cp = await manager.create({
				module: 'elaboration',
				operationLabel: 'Test',
				items,
			});

			// Complete one item
			await manager.completeItem(cp.id, 'item0');

			const resumed = await manager.resume(cp.id);
			expect(resumed).not.toBeNull();
			expect(resumed!.remainingItems).toHaveLength(2);
			expect(resumed!.completedItems).toHaveLength(1);
			expect(resumed!.status).toBe('active');
		});

		it('returns null for completed checkpoints', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: [],
			});
			await manager.complete(cp.id);

			const result = await manager.resume(cp.id);
			expect(result).toBeNull();
		});

		it('returns null for non-existent checkpoints', async () => {
			const result = await manager.resume('nosuchcp');
			expect(result).toBeNull();
		});
	});

	describe('listIncomplete', () => {
		it('returns only active checkpoints', async () => {
			const cp1 = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Active 1',
				items: makeItems(1),
			});
			const cp2 = await manager.create({
				module: 'elaboration',
				operationLabel: 'Active 2',
				items: makeItems(1),
			});
			const cp3 = await manager.create({
				module: 'enrichment',
				operationLabel: 'Completed',
				items: [],
			});
			await manager.complete(cp3.id);

			const incomplete = await manager.listIncomplete();
			expect(incomplete).toHaveLength(2);
			const ids = incomplete.map((c) => c.id).sort();
			expect(ids).toEqual([cp1.id, cp2.id].sort());
		});

		it('returns empty array when no checkpoints exist', async () => {
			const incomplete = await manager.listIncomplete();
			expect(incomplete).toEqual([]);
		});
	});

	describe('listAll', () => {
		it('returns all checkpoints regardless of status', async () => {
			const cp1 = await manager.create({
				module: 'deep-dive',
				operationLabel: 'A',
				items: [],
			});
			const cp2 = await manager.create({
				module: 'elaboration',
				operationLabel: 'B',
				items: [],
			});
			await manager.complete(cp2.id);

			const all = await manager.listAll();
			expect(all).toHaveLength(2);
		});
	});

	describe('cleanup', () => {
		it('removes completed/discarded checkpoints older than max age', async () => {
			const cp1 = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Old completed',
				items: [],
			});
			await manager.complete(cp1.id);

			// Manually backdating the updatedAt to simulate old checkpoint
			const loaded = await manager.load(cp1.id);
			loaded!.updatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
			const path = `.synapse/checkpoints/${cp1.id}.json`;
			mockFiles.set(path, JSON.stringify(loaded, null, 2));

			const cp2 = await manager.create({
				module: 'elaboration',
				operationLabel: 'Active',
				items: makeItems(1),
			});

			const removed = await manager.cleanup(7 * 24 * 60 * 60 * 1000);
			expect(removed).toBe(1);

			// Active checkpoint should still exist
			const stillActive = await manager.load(cp2.id);
			expect(stillActive).not.toBeNull();
		});

		it('does not remove active checkpoints regardless of age', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Old active',
				items: makeItems(1),
			});

			// Backdate
			const loaded = await manager.load(cp.id);
			loaded!.updatedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
			const path = `.synapse/checkpoints/${cp.id}.json`;
			mockFiles.set(path, JSON.stringify(loaded, null, 2));

			const removed = await manager.cleanup(1);
			expect(removed).toBe(0);
		});
	});

	describe('load', () => {
		it('returns null for non-existent checkpoint', async () => {
			const loaded = await manager.load('nosuchid');
			expect(loaded).toBeNull();
		});

		it('returns null for corrupt file', async () => {
			mockFiles.set('.synapse/checkpoints/corrupt.json', 'not json');
			const loaded = await manager.load('corrupt');
			expect(loaded).toBeNull();
		});
	});

	describe('ID validation', () => {
		it('rejects IDs with path traversal characters', async () => {
			await expect(manager.load('../etc/passwd')).rejects.toThrow('Invalid checkpoint ID');
		});

		it('rejects IDs with slashes', async () => {
			await expect(manager.load('foo/bar')).rejects.toThrow('Invalid checkpoint ID');
		});

		it('rejects IDs with dots', async () => {
			await expect(manager.load('foo.bar')).rejects.toThrow('Invalid checkpoint ID');
		});

		it('accepts valid base36 IDs', async () => {
			// Should not throw, just return null for non-existent
			const loaded = await manager.load('abc123def');
			expect(loaded).toBeNull();
		});
	});

	describe('concurrency guard', () => {
		it('serializes concurrent writes to the same checkpoint', async () => {
			const cp = await manager.create({
				module: 'deep-dive',
				operationLabel: 'Test',
				items: makeItems(5),
			});

			// Fire multiple completeItem calls concurrently
			const results = await Promise.all([
				manager.completeItem(cp.id, 'item0'),
				manager.completeItem(cp.id, 'item1'),
				manager.completeItem(cp.id, 'item2'),
			]);

			// All should succeed
			const finalLoaded = await manager.load(cp.id);
			expect(finalLoaded!.completedItems).toHaveLength(3);
			expect(finalLoaded!.remainingItems).toHaveLength(2);
		});
	});
});
