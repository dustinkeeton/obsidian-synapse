import { describe, it, expect, beforeEach } from 'vitest';
import type { App } from 'obsidian';
import { IllustrateStore } from './proposal-store';
import { createMockApp } from '../__test-utils__/mock-factories';
import { DEFAULT_SETTINGS } from '../settings';
import type { IllustrateProposal } from './types';

function proposal(id: string, status: IllustrateProposal['status'] = 'pending'): IllustrateProposal {
	return {
		id, sourceNotePath: 'notes/a.md', createdAt: '2026-01-01T00:00:00Z', status,
		items: [{ id: `${id}-d`, kind: 'diagram', anchor: 'x', caption: 'c', rationale: '', mermaid: 'flowchart TD\nA' }],
	};
}

describe('IllustrateStore', () => {
	let app: ReturnType<typeof createMockApp>;
	let store: IllustrateStore;
	let files: Record<string, string>;

	beforeEach(() => {
		app = createMockApp();
		files = {};
		app.vault.adapter.write.mockImplementation((path: string, content: string) => { files[path] = content; return Promise.resolve(); });
		app.vault.adapter.read.mockImplementation((path: string) => Promise.resolve(files[path]));
		app.vault.adapter.exists.mockResolvedValue(true);
		app.vault.adapter.list.mockImplementation(() => Promise.resolve({ files: Object.keys(files), folders: [] }));
		store = new IllustrateStore(app as unknown as App, () => DEFAULT_SETTINGS);
	});

	it('saves under the proposal folder with a sanitized file name', async () => {
		await store.save({ ...proposal('abcdef1234'), sourceNotePath: 'a/../b/c.md' });
		expect(Object.keys(files)).toEqual(['.synapse/illustrate/a-_-b-c-illustrate-abcdef12.json']);
	});

	it('loads by id and lists only pending proposals', async () => {
		await store.save(proposal('p1'));
		await store.save(proposal('p2', 'rejected'));
		expect((await store.load('p2'))?.status).toBe('rejected');
		expect((await store.loadPending()).map(p => p.id)).toEqual(['p1']);
	});

	it('updates status with the accepted item ids', async () => {
		await store.save(proposal('p1'));
		await store.updateStatus('p1', 'partially-accepted', ['p1-d']);
		expect(await store.load('p1')).toMatchObject({ status: 'partially-accepted', acceptedItemIds: ['p1-d'] });
	});

	it('skips corrupt files', async () => {
		files['.synapse/illustrate/bad.json'] = '{not json';
		await store.save(proposal('p1'));
		expect(await store.loadAll()).toHaveLength(1);
	});
});
