import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TitleModule } from './index';
import { DEFAULT_SETTINGS } from '../settings';
import { NotificationManager } from '../shared';
import { TFile, TFolder, Notice } from '../__mocks__/obsidian';

// Deterministic suggester output, mutated per test via hoisted state. `calls`
// counts suggestTitle invocations — the dedup guard returns BEFORE the suggester
// runs, so this is a robust signal for "a new proposal was (not) generated".
const mockSuggester = vi.hoisted(() => ({
	title: 'Neural Networks',
	reasoning: 'Content is about neural networks',
	calls: 0,
}));

vi.mock('./title-suggester', () => ({
	TitleSuggester: class MockTitleSuggester {
		constructor(_client: unknown) {}
		suggestTitle = vi.fn(async () => {
			mockSuggester.calls++;
			return { title: mockSuggester.title, reasoning: mockSuggester.reasoning };
		});
		checkTitleMismatch = vi.fn(async () => ({ isMismatch: false }));
	},
}));

/** In-memory adapter so TitleProposalStore round-trips proposals via JSON. */
function createMemoryAdapter() {
	const files = new Map<string, string>();
	return {
		_files: files,
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

/** A TFile whose `parent` folder path is derived from the path. */
function makeFile(path: string): TFile {
	const file = new TFile(path);
	const slash = path.lastIndexOf('/');
	if (slash >= 0) file.parent = new TFolder(path.slice(0, slash));
	return file;
}

/**
 * Build a TitleModule over an in-memory vault. `notes` seeds path → content;
 * each becomes a TFile so `getAbstractFileByPath` returns it and `read`/`process`
 * operate on its content.
 */
function harness(notes: Record<string, string>, opts?: { autoAccept?: boolean }) {
	const adapter = createMemoryAdapter();
	const settings = structuredClone(DEFAULT_SETTINGS);
	if (opts?.autoAccept) settings.autoAccept.title = true;
	const notifications = new NotificationManager();

	const files = new Map<string, TFile | TFolder>();
	const contents = new Map<string, string>();
	for (const [path, content] of Object.entries(notes)) {
		files.set(path, makeFile(path));
		contents.set(path, content);
	}

	const addNote = (path: string, content: string) => {
		files.set(path, makeFile(path));
		contents.set(path, content);
	};
	const removeNote = (path: string) => {
		files.delete(path);
		contents.delete(path);
	};
	const addFolder = (path: string) => { files.set(path, new TFolder(path)); };

	const renameSpy = vi.fn(async (file: TFile, newPath: string) => {
		contents.set(newPath, contents.get(file.path) ?? '');
		contents.delete(file.path);
		files.delete(file.path);
		files.set(newPath, makeFile(newPath));
	});
	const processSpy = vi.fn(async (file: TFile, fn: (c: string) => string) => {
		const next = fn(contents.get(file.path) ?? '');
		contents.set(file.path, next);
		return next;
	});
	const trashSpy = vi.fn(async (file: TFile) => {
		files.delete(file.path);
		contents.delete(file.path);
	});

	const mockPlugin = {
		app: {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
				read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ''),
				rename: renameSpy,
				process: processSpy,
				createFolder: vi.fn().mockResolvedValue(undefined),
				adapter,
			},
			fileManager: { trashFile: trashSpy },
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		},
	};

	const mod = new TitleModule(
		mockPlugin as never,
		() => settings,
		notifications,
		() => settings.autoAccept.title,
	);

	return { mod, settings, adapter, files, contents, addNote, removeNote, addFolder, renameSpy, processSpy, trashSpy };
}

const SOURCE = 'Inbox/Untitled.md';
const TARGET = 'Inbox/Neural Networks.md';
const BODY = '# Notes\n\nDetailed content about neural networks and training.';

async function firstPending(mod: TitleModule) {
	const pending = await mod.getPendingProposals();
	return pending[0];
}

describe('TitleModule duplicate handling (#408)', () => {
	beforeEach(() => {
		Notice.instances.length = 0;
		mockSuggester.title = 'Neural Networks';
		mockSuggester.reasoning = 'Content is about neural networks';
		mockSuggester.calls = 0;
	});
	afterEach(() => { vi.restoreAllMocks(); });

	it('flags a collision at proposal time via conflictsWith', async () => {
		const h = harness({ [SOURCE]: BODY, [TARGET]: 'existing' });
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);

		const p = await firstPending(h.mod);
		expect(p.conflictsWith).toBe(TARGET);
		expect(p.contentKey).toBeTruthy();
		expect(h.renameSpy).not.toHaveBeenCalled(); // auto-accept off → stays pending
	});

	it('resolves a collision with "iterate" by renaming to a suffixed path', async () => {
		const h = harness({ [SOURCE]: BODY, [TARGET]: 'existing' });
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		await h.mod.acceptProposal(p.id, { resolution: 'iterate' });

		expect(h.renameSpy).toHaveBeenCalledTimes(1);
		expect(h.renameSpy.mock.calls[0][1]).toBe('Inbox/Neural Networks-1.md');
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
	});

	it('resolves a collision with "merge": unions frontmatter, joins bodies with a rule, trashes the source', async () => {
		const sourceContent = `---\ntags: [src]\naliases: [oldname]\nfoo: sourceval\n---\nSource body`;
		const targetContent = `---\ntags: [tgt]\ntitle: Keep\n---\nTarget body`;
		const h = harness({ [SOURCE]: sourceContent, [TARGET]: targetContent });
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		await h.mod.acceptProposal(p.id, { resolution: 'merge' });

		expect(h.processSpy).toHaveBeenCalledTimes(1);
		const written = h.contents.get(TARGET)!;
		// Bodies joined target-first by a horizontal rule.
		expect(written).toContain('Target body\n\n---\n\nSource body');
		// Frontmatter union: target wins on scalars; tags + aliases unioned.
		expect(written).toContain('- tgt');
		expect(written).toContain('- src');
		expect(written).toContain('- oldname');
		expect(written).toContain('foo: sourceval');
		expect(written).toContain('title: Keep');
		// Source trashed (recoverable), not renamed.
		expect(h.trashSpy).toHaveBeenCalledTimes(1);
		expect(h.trashSpy.mock.calls[0][0].path).toBe(SOURCE);
		expect(h.files.has(SOURCE)).toBe(false);
		expect(h.renameSpy).not.toHaveBeenCalled();
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
	});

	it('auto-accept honors the "iterate" strategy and announces the suffixed name', async () => {
		const h = harness({ [SOURCE]: BODY, [TARGET]: 'existing' }, { autoAccept: true });
		h.settings.title.duplicateHandling = 'iterate';
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.renameSpy).toHaveBeenCalledTimes(1);
		expect(h.renameSpy.mock.calls[0][1]).toBe('Inbox/Neural Networks-1.md');
		expect(Notice.instances.some(n => n.message === 'Synapse: Auto-accepted title "Neural Networks-1"')).toBe(true);
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
	});

	it('auto-accept honors the "merge" strategy and announces the merge target', async () => {
		const h = harness({ [SOURCE]: `Source body`, [TARGET]: `Target body` }, { autoAccept: true });
		h.settings.title.duplicateHandling = 'merge';
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.processSpy).toHaveBeenCalledTimes(1);
		expect(h.trashSpy).toHaveBeenCalledTimes(1);
		expect(h.contents.get(TARGET)).toContain('Target body\n\n---\n\nSource body');
		expect(Notice.instances.some(n => n.message === 'Synapse: Auto-merged into "Neural Networks"')).toBe(true);
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
	});

	it('accept-time recheck: a collision that appeared after the proposal surfaces a choice and does NOT overwrite', async () => {
		const h = harness({ [SOURCE]: BODY }); // no target yet → no conflict at proposal time
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);
		expect(p.conflictsWith).toBeUndefined();

		// Collision appears, then a plain Accept (no resolution).
		h.addNote(TARGET, 'existing');
		await h.mod.acceptProposal(p.id);

		expect(h.renameSpy).not.toHaveBeenCalled();
		expect(h.contents.get(TARGET)).toBe('existing'); // never overwritten
		const still = await firstPending(h.mod);
		expect(still.status).toBe('pending');
		expect(still.conflictsWith).toBe(TARGET); // hint persisted for the card
		expect(Notice.instances.some(n => n.message?.includes('already exists'))).toBe(true);
	});

	it('accept-time recheck: a stale conflictsWith is ignored when the collision disappeared, renaming cleanly', async () => {
		const h = harness({ [SOURCE]: BODY, [TARGET]: 'existing' });
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);
		expect(p.conflictsWith).toBe(TARGET);

		// Target removed before accept; a plain Accept should rename cleanly.
		h.removeNote(TARGET);
		await h.mod.acceptProposal(p.id);

		expect(h.renameSpy).toHaveBeenCalledTimes(1);
		expect(h.renameSpy.mock.calls[0][1]).toBe(TARGET); // clean path, no spurious suffix
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
	});

	it('does not re-propose a rejected colliding title for unchanged content, but does after a content edit', async () => {
		const h = harness({ [SOURCE]: BODY, [TARGET]: 'existing' });
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);
		expect(mockSuggester.calls).toBe(1);
		await h.mod.rejectProposal(p.id);
		expect(await h.mod.getPendingProposals()).toHaveLength(0);

		// Re-scan with UNCHANGED content → contentKey guard suppresses a new
		// proposal: the suggester is never reached, so no regeneration occurs.
		await h.mod.checkUntitled(SOURCE);
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
		expect(mockSuggester.calls).toBe(1);

		// Edit the note → key changes → a new proposal is allowed.
		h.addNote(SOURCE, BODY + '\n\nNew paragraph.');
		await h.mod.checkUntitled(SOURCE);
		expect(await h.mod.getPendingProposals()).toHaveLength(1);
		expect(mockSuggester.calls).toBe(2);
	});

	it('merge falls back to a plain rename when the target is not a note (e.g. a folder)', async () => {
		const h = harness({ [SOURCE]: BODY });
		h.addFolder(TARGET); // a folder occupies the target path
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);
		expect(p.conflictsWith).toBe(TARGET);

		await h.mod.acceptProposal(p.id, { resolution: 'merge' });

		expect(h.processSpy).not.toHaveBeenCalled();
		expect(h.trashSpy).not.toHaveBeenCalled();
		expect(h.renameSpy).toHaveBeenCalledTimes(1);
		expect(h.renameSpy.mock.calls[0][1]).toBe(TARGET);
		expect(Notice.instances.some(n => n.message?.includes('Nothing to merge into'))).toBe(true);
	});
});
