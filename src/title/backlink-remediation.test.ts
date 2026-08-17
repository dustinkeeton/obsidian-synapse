import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	collectInboundLinks,
	rewriteLinkText,
	rewriteContent,
	InboundLinkRef,
} from './backlink-remediation';
import { TitleModule } from './index';
import { DEFAULT_SETTINGS } from '../settings';
import { NotificationManager } from '../shared';
import { TFile, TFolder, Notice } from '../__mocks__/obsidian';

const OLD = 'Inbox/Untitled.md';
const NEW = 'Inbox/Neural Networks.md';

describe('rewriteLinkText', () => {
	it('aliases a bare wikilink with its old written path so the reader sees no change', () => {
		expect(rewriteLinkText('[[Untitled]]', OLD, NEW)).toBe('[[Neural Networks|Untitled]]');
	});

	it('keeps an existing alias verbatim', () => {
		expect(rewriteLinkText('[[Untitled|Custom]]', OLD, NEW)).toBe('[[Neural Networks|Custom]]');
	});

	it('keeps an empty alias verbatim', () => {
		expect(rewriteLinkText('[[Untitled|]]', OLD, NEW)).toBe('[[Neural Networks|]]');
	});

	it('retargets a heading link and aliases with the old path', () => {
		expect(rewriteLinkText('[[Untitled#Setup]]', OLD, NEW)).toBe('[[Neural Networks#Setup|Untitled]]');
	});

	it('retargets a block ref the same way', () => {
		expect(rewriteLinkText('[[Untitled#^abc123]]', OLD, NEW)).toBe('[[Neural Networks#^abc123|Untitled]]');
	});

	it('keeps a custom alias on a heading link untouched', () => {
		expect(rewriteLinkText('[[Untitled#Setup|see setup]]', OLD, NEW)).toBe('[[Neural Networks#Setup|see setup]]');
	});

	it('preserves a folder prefix and .md extension as written', () => {
		expect(rewriteLinkText('[[Inbox/Untitled]]', OLD, NEW)).toBe('[[Inbox/Neural Networks|Inbox/Untitled]]');
		expect(rewriteLinkText('[[Inbox/Untitled.md|Custom]]', OLD, NEW)).toBe('[[Inbox/Neural Networks.md|Custom]]');
	});

	it('matches the written basename case-insensitively but rewrites to the real new name', () => {
		expect(rewriteLinkText('[[untitled]]', OLD, NEW)).toBe('[[Neural Networks|untitled]]');
	});

	it('retargets an embed without adding an alias', () => {
		expect(rewriteLinkText('![[Untitled]]', OLD, NEW)).toBe('![[Neural Networks]]');
	});

	it('keeps an existing embed alias (e.g. sizing)', () => {
		expect(rewriteLinkText('![[Untitled|300]]', OLD, NEW)).toBe('![[Neural Networks|300]]');
	});

	it('retargets an embed subpath without adding an alias', () => {
		expect(rewriteLinkText('![[Untitled#Setup]]', OLD, NEW)).toBe('![[Neural Networks#Setup]]');
	});

	it('rewrites only the path of a markdown link, re-encoding it', () => {
		expect(rewriteLinkText('[my text](Untitled.md)', OLD, NEW)).toBe('[my text](Neural%20Networks.md)');
	});

	it('decodes percent-encoded markdown paths and keeps the anchor', () => {
		expect(rewriteLinkText('[t](Old%20Note.md#sec)', 'Old Note.md', 'New Note.md')).toBe('[t](New%20Note.md#sec)');
	});

	it('keeps angle-bracket markdown targets unencoded', () => {
		expect(rewriteLinkText('[t](<Old Note.md#sec>)', 'Old Note.md', 'New Note.md')).toBe('[t](<New Note.md#sec>)');
	});

	it('returns null for a link that does not target the old note', () => {
		expect(rewriteLinkText('[[Other Note]]', OLD, NEW)).toBeNull();
		expect(rewriteLinkText('[t](Other%20Note.md)', OLD, NEW)).toBeNull();
	});

	it('returns null for unrecognized text', () => {
		expect(rewriteLinkText('plain prose', OLD, NEW)).toBeNull();
		expect(rewriteLinkText('[[Untitled]] trailing', OLD, NEW)).toBeNull();
	});
});

describe('rewriteContent', () => {
	it('replaces every exact occurrence of each collected link', () => {
		const content = 'See [[Untitled]] and again [[Untitled]] plus [[Untitled|Custom]].';
		const out = rewriteContent(content, ['[[Untitled]]', '[[Untitled|Custom]]'], OLD, NEW);
		expect(out).toBe(
			'See [[Neural Networks|Untitled]] and again [[Neural Networks|Untitled]] plus [[Neural Networks|Custom]].'
		);
	});

	it('leaves content untouched when no collected link matches the old note', () => {
		const content = 'See [[Other Note]].';
		expect(rewriteContent(content, ['[[Other Note]]'], OLD, NEW)).toBe(content);
	});

	it('leaves non-link originals untouched (never corrupts prose)', () => {
		const content = 'Untitled appears as a plain word here.';
		expect(rewriteContent(content, ['Untitled'], OLD, NEW)).toBe(content);
	});
});

describe('collectInboundLinks', () => {
	const file = new TFile(OLD) as never;

	function appWith(getBacklinksForFile: unknown) {
		return { metadataCache: { getBacklinksForFile } } as never;
	}

	it('returns [] when getBacklinksForFile is unavailable', () => {
		expect(collectInboundLinks({ metadataCache: {} } as never, file)).toEqual([]);
	});

	it('reads a Map-shaped data dict', () => {
		const data = new Map([['A.md', [{ link: 'Untitled', original: '[[Untitled]]' }]]]);
		const refs = collectInboundLinks(appWith(() => ({ data })), file);
		expect(refs).toEqual([{ sourcePath: 'A.md', original: '[[Untitled]]' }]);
	});

	it('reads a plain-object data dict', () => {
		const data = { 'B.md': [{ link: 'Untitled', original: '[[Untitled|x]]' }] };
		const refs = collectInboundLinks(appWith(() => ({ data })), file);
		expect(refs).toEqual([{ sourcePath: 'B.md', original: '[[Untitled|x]]' }]);
	});

	it('skips entries without a usable original and survives a throwing cache', () => {
		const data = new Map([['A.md', [{ link: 'Untitled' }, null, { original: '' }]]]);
		expect(collectInboundLinks(appWith(() => ({ data })), file)).toEqual([]);
		expect(collectInboundLinks(appWith(() => { throw new Error('boom'); }), file)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Integration: remediation wired into TitleModule.acceptProposal
// ---------------------------------------------------------------------------

const mockSuggester = vi.hoisted(() => ({
	title: 'Neural Networks',
	reasoning: 'Content is about neural networks',
}));

vi.mock('./title-suggester', () => ({
	TitleSuggester: class MockTitleSuggester {
		constructor(_client: unknown) {}
		suggestTitle = vi.fn(async () => ({ title: mockSuggester.title, reasoning: mockSuggester.reasoning }));
		checkTitleMismatch = vi.fn(async () => ({ isMismatch: false }));
	},
}));

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

/** A TFile whose `parent` folder path is derived from the path. */
function makeFile(path: string): TFile {
	const file = new TFile(path);
	const slash = path.lastIndexOf('/');
	if (slash >= 0) file.parent = new TFolder(path.slice(0, slash));
	return file;
}

/**
 * TitleModule over an in-memory vault whose metadataCache derives backlinks
 * from a declared `links` map: target path -> refs pointing at it.
 */
function harness(
	notes: Record<string, string>,
	links: Record<string, InboundLinkRef[]>,
	opts?: { autoAccept?: boolean }
) {
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
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
				getBacklinksForFile: vi.fn((file: TFile) => ({
					data: new Map(
						Object.entries(
							(links[file.path] ?? []).reduce<Record<string, { original: string }[]>>((acc, ref) => {
								(acc[ref.sourcePath] ??= []).push({ original: ref.original });
								return acc;
							}, {})
						)
					),
				})),
			},
		},
	};

	const mod = new TitleModule(
		mockPlugin as never,
		() => settings,
		notifications,
		() => settings.autoAccept.title,
	);

	return { mod, settings, contents, files, processSpy, renameSpy, trashSpy };
}

const SOURCE = 'Inbox/Untitled.md';
const TARGET = 'Inbox/Neural Networks.md';
const BODY = '# Notes\n\nDetailed content about neural networks and training.';

async function firstPending(mod: TitleModule) {
	const pending = await mod.getPendingProposals();
	return pending[0];
}

describe('TitleModule backlink remediation (#485)', () => {
	beforeEach(() => {
		Notice.instances.length = 0;
		mockSuggester.title = 'Neural Networks';
	});
	afterEach(() => { vi.restoreAllMocks(); });

	it('plain rename: rewrites every inbound link form, preserving display text byte-for-byte', async () => {
		const refA = 'Intro: [[Untitled]] then [[Untitled|the draft]] and [[Untitled#Setup]].';
		const refB = 'Embed ![[Untitled]] plus md [link text](Untitled.md).';
		const h = harness(
			{ [SOURCE]: BODY, 'Refs/A.md': refA, 'Refs/B.md': refB },
			{
				[SOURCE]: [
					{ sourcePath: 'Refs/A.md', original: '[[Untitled]]' },
					{ sourcePath: 'Refs/A.md', original: '[[Untitled|the draft]]' },
					{ sourcePath: 'Refs/A.md', original: '[[Untitled#Setup]]' },
					{ sourcePath: 'Refs/B.md', original: '![[Untitled]]' },
					{ sourcePath: 'Refs/B.md', original: '[link text](Untitled.md)' },
				],
			}
		);
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		await h.mod.acceptProposal(p.id);

		expect(h.renameSpy).toHaveBeenCalledTimes(1);
		expect(h.contents.get('Refs/A.md')).toBe(
			'Intro: [[Neural Networks|Untitled]] then [[Neural Networks|the draft]] and [[Neural Networks#Setup|Untitled]].'
		);
		expect(h.contents.get('Refs/B.md')).toBe(
			'Embed ![[Neural Networks]] plus md [link text](Neural%20Networks.md).'
		);
	});

	it('iterate resolution: links retarget to the suffixed path actually used', async () => {
		const h = harness(
			{ [SOURCE]: BODY, [TARGET]: 'existing', 'Refs/A.md': 'See [[Untitled]].' },
			{ [SOURCE]: [{ sourcePath: 'Refs/A.md', original: '[[Untitled]]' }] }
		);
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		await h.mod.acceptProposal(p.id, { resolution: 'iterate' });

		expect(h.renameSpy.mock.calls[0][1]).toBe('Inbox/Neural Networks-1.md');
		expect(h.contents.get('Refs/A.md')).toBe('See [[Neural Networks-1|Untitled]].');
	});

	it('merge resolution: links to the trashed source retarget to the surviving note', async () => {
		const h = harness(
			{ [SOURCE]: 'Source body', [TARGET]: 'Target body', 'Refs/A.md': 'See [[Untitled|the draft]].' },
			{ [SOURCE]: [{ sourcePath: 'Refs/A.md', original: '[[Untitled|the draft]]' }] }
		);
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		await h.mod.acceptProposal(p.id, { resolution: 'merge' });

		expect(h.trashSpy).toHaveBeenCalledTimes(1);
		expect(h.contents.get('Refs/A.md')).toBe('See [[Neural Networks|the draft]].');
	});

	it('self-links: a note linking to itself is rewritten at its NEW path after the rename', async () => {
		const h = harness(
			{ [SOURCE]: `${BODY}\n\nSee [[Untitled#Setup]].` },
			{ [SOURCE]: [{ sourcePath: SOURCE, original: '[[Untitled#Setup]]' }] }
		);
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		await h.mod.acceptProposal(p.id);

		expect(h.contents.get(TARGET)).toContain('See [[Neural Networks#Setup|Untitled]].');
	});

	it('auto-accept path remediates too', async () => {
		const h = harness(
			{ [SOURCE]: BODY, 'Refs/A.md': 'See [[Untitled]].' },
			{ [SOURCE]: [{ sourcePath: 'Refs/A.md', original: '[[Untitled]]' }] },
			{ autoAccept: true }
		);
		await h.mod.onload();

		await h.mod.checkUntitled(SOURCE);

		expect(h.renameSpy).toHaveBeenCalledTimes(1);
		expect(h.contents.get('Refs/A.md')).toBe('See [[Neural Networks|Untitled]].');
	});

	it('a failing rewrite in one note neither corrupts it nor blocks other notes or the accept', async () => {
		const h = harness(
			{ [SOURCE]: BODY, 'Refs/A.md': 'See [[Untitled]].', 'Refs/B.md': 'Also [[Untitled]].' },
			{
				[SOURCE]: [
					{ sourcePath: 'Refs/A.md', original: '[[Untitled]]' },
					{ sourcePath: 'Refs/B.md', original: '[[Untitled]]' },
				],
			}
		);
		const realProcess = h.processSpy.getMockImplementation()!;
		h.processSpy.mockImplementation(async (file: TFile, fn: (c: string) => string) => {
			if (file.path === 'Refs/A.md') throw new Error('disk full');
			return realProcess(file, fn);
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		const outcome = await h.mod.acceptProposal(p.id);

		expect(outcome.status).toBe('renamed');
		expect(h.contents.get('Refs/A.md')).toBe('See [[Untitled]].'); // untouched, not corrupted
		expect(h.contents.get('Refs/B.md')).toBe('Also [[Neural Networks|Untitled]].');
		expect(warn).toHaveBeenCalled();
		expect(await h.mod.getPendingProposals()).toHaveLength(0);
	});

	it('a referencing note that vanished before remediation is skipped without error', async () => {
		const h = harness(
			{ [SOURCE]: BODY },
			{ [SOURCE]: [{ sourcePath: 'Refs/Gone.md', original: '[[Untitled]]' }] }
		);
		await h.mod.onload();
		await h.mod.checkUntitled(SOURCE);
		const p = await firstPending(h.mod);

		const outcome = await h.mod.acceptProposal(p.id);

		expect(outcome.status).toBe('renamed');
	});
});
