import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TitleModule } from './index';
import { DEFAULT_SETTINGS } from '../settings';
import { AIClient, NoteOperationQueue } from '../shared';
import type { AIRequestOptions } from '../shared';
import { TFile, TFolder } from '../__mocks__/obsidian';
import { makeModuleDeps } from '../__test-utils__/mock-factories';

const SOURCE = 'Inbox/Untitled.md';
const TARGET = 'Inbox/Neural Networks.md';
const BODY = '# Notes\n\nDetailed content about neural networks and training.';
const AI_RESPONSE = 'TITLE: Neural Networks\nREASON: Content is about neural networks';

/** In-memory adapter so TitleProposalStore round-trips proposals via JSON. */
function createMemoryAdapter() {
	const files = new Map<string, string>();
	return {
		read: vi.fn(async (path: string) => {
			if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
			return files.get(path)!;
		}),
		write: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
		exists: vi.fn(async (path: string) => {
			if (files.has(path)) return true;
			for (const key of files.keys()) if (key.startsWith(path + '/')) return true;
			return false;
		}),
		remove: vi.fn(async (path: string) => { files.delete(path); }),
		list: vi.fn(async (folder: string) => {
			const out: string[] = [];
			for (const key of files.keys()) if (key.startsWith(folder + '/')) out.push(key);
			return { files: out, folders: [] };
		}),
	};
}

function makeFile(path: string): TFile {
	const file = new TFile(path);
	const slash = path.lastIndexOf('/');
	if (slash >= 0) file.parent = new TFolder(path.slice(0, slash));
	return file;
}

function harness(notes: Record<string, string>, opts?: { autoAccept?: boolean }) {
	const settings = structuredClone(DEFAULT_SETTINGS);
	if (opts?.autoAccept) settings.autoAccept.title = true;

	const files = new Map<string, TFile | TFolder>();
	const contents = new Map<string, string>();
	for (const [path, content] of Object.entries(notes)) {
		files.set(path, makeFile(path));
		contents.set(path, content);
	}

	const info = vi.fn();
	const success = vi.fn();
	const notifications = { info, success, notifyError: vi.fn(), startOperation: vi.fn() };

	const mockPlugin = {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
				read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ''),
				rename: vi.fn(async (file: TFile, newPath: string) => {
					contents.set(newPath, contents.get(file.path) ?? '');
					contents.delete(file.path);
					files.delete(file.path);
					files.set(newPath, makeFile(newPath));
				}),
				process: vi.fn(async (file: TFile, fn: (c: string) => string) => {
					const next = fn(contents.get(file.path) ?? '');
					contents.set(file.path, next);
					return next;
				}),
				createFolder: vi.fn().mockResolvedValue(undefined),
				adapter: createMemoryAdapter(),
			},
			fileManager: {
				trashFile: vi.fn(async (file: TFile) => {
					files.delete(file.path);
					contents.delete(file.path);
				}),
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		},
	};

	const mod = new TitleModule(
		makeModuleDeps({
			plugin: mockPlugin as never,
			getSettings: () => settings,
			notifications: notifications as never,
			noteQueue: new NoteOperationQueue(),
		}),
		() => settings.autoAccept.title
	);

	return { mod, settings, info, success };
}

describe('TitleModule cache reporting (#527)', () => {
	let replayed: boolean;

	beforeEach(() => {
		replayed = false;
		vi.spyOn(AIClient.prototype, 'complete').mockImplementation(
			async (_prompt: string, _system?: string, aiOpts?: AIRequestOptions) => {
				if (replayed) aiOpts?.onCacheHit?.();
				return AI_RESPONSE;
			}
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it('says a pending title proposal replayed a cached AI response', async () => {
		replayed = true;
		const h = harness({ [SOURCE]: BODY });
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.success.mock.calls.at(-1)?.[0]).toBe('Title proposal ready — used a cached AI response');
	});

	it('keeps the plain message for a fresh title proposal', async () => {
		const h = harness({ [SOURCE]: BODY });
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.success.mock.calls.at(-1)?.[0]).toBe('Title proposal ready');
	});

	it('says an auto-accepted rename replayed a cached AI response', async () => {
		replayed = true;
		const h = harness({ [SOURCE]: BODY }, { autoAccept: true });
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.info.mock.calls.at(-1)?.[0]).toBe('Auto-accepted title "Neural Networks" — used a cached AI response');
	});

	it('keeps the plain message for a fresh auto-accepted rename', async () => {
		const h = harness({ [SOURCE]: BODY }, { autoAccept: true });
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.info.mock.calls.at(-1)?.[0]).toBe('Auto-accepted title "Neural Networks"');
	});

	it('says an auto-merge replayed a cached AI response', async () => {
		replayed = true;
		const h = harness({ [SOURCE]: 'Source body', [TARGET]: 'Target body' }, { autoAccept: true });
		h.settings.title.duplicateHandling = 'merge';
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.info.mock.calls.at(-1)?.[0]).toBe('Auto-merged into "Neural Networks" — used a cached AI response');
	});
});
