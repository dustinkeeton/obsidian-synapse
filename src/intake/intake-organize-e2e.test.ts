import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { IntakeModule } from './index';
import { OrganizeModule } from '../organize';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile, TFolder } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { Plugin, TFile as ObsidianTFile } from 'obsidian';

/** Spy-backed stand-ins for the in-memory vault/adapter/fileManager surfaces. */
interface MockAdapter {
	read: Mock<(path: string) => Promise<string>>;
	write: Mock<(path: string, content: string) => Promise<void>>;
	exists: Mock<(path: string) => Promise<boolean>>;
	remove: Mock<(path: string) => Promise<void>>;
	list: Mock<(folder: string) => Promise<{ files: string[]; folders: string[] }>>;
}
interface MockVault {
	on: Mock<(event: string, cb: (file: ObsidianTFile) => void) => { event: string }>;
	read: Mock<(file: ObsidianTFile) => Promise<string>>;
	process: Mock<(file: ObsidianTFile, fn: (data: string) => string) => Promise<string>>;
	create: Mock<(path: string, content: string) => Promise<ObsidianTFile>>;
	createFolder: Mock<(path: string) => Promise<void>>;
	getRoot: () => TFolder;
	getAbstractFileByPath: Mock<(path: string) => ObsidianTFile | null>;
	rename: Mock<(file: ObsidianTFile, newPath: string) => Promise<void>>;
	adapter: MockAdapter;
}
interface MockFileManager {
	renameFile: Mock<(file: ObsidianTFile, newPath: string) => Promise<void>>;
}

/**
 * Integration test for the intake → organize handshake (#227).
 *
 * Unlike intake-module.test.ts — which stubs `fireOnFile` to simulate organize
 * — this wires the REAL {@link OrganizeModule} into intake's `fireOnFile`. The
 * ONLY mocked boundary is the AI: {@link ContentAnalyzer} (which wraps the
 * network-bound AIClient) is replaced with a controllable topic/confidence
 * source. The real DirectoryMatcher, OrganizeStore, and `vault.rename` mover all
 * run, so this confirms the production organize → intake contract end-to-end:
 *
 *   1. High-confidence note with a matching directory → organize's `vault.rename`
 *      moves it out of Inbox (mutating `TFile.path` IN PLACE) → intake detects
 *      the move (originalPath !== file.path) → breadcrumb written → the
 *      `moveWhenDone` fallback is NOT applied (no double move).
 *   2. Low-confidence note → organize keeps it in Inbox (no-op / would-be
 *      proposal) → with no `moveWhenDone`, the note stays put and NO breadcrumb
 *      is written; with `moveWhenDone` set, intake's fallback relocates it.
 *   3. The `originalPath !== file.path` detection holds against the REAL module
 *      because `vault.rename` mutates the same TFile object in place.
 */

// The mocked AI boundary. `vi.hoisted` so the mock factory (hoisted above
// imports) can safely reference this holder; tests mutate it per-case.
const ai = vi.hoisted(() => ({
	topics: [] as Array<{ label: string; confidence: number }>,
	tags: [] as string[],
}));

vi.mock('../organize/content-analyzer', () => ({
	ContentAnalyzer: class MockContentAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		// Mirrors the real analyzer's shape but returns controlled topics so the
		// REAL DirectoryMatcher makes the move/keep decision deterministically.
		analyze = vi.fn(async (file: { path: string }) => ({
			notePath: file.path,
			topics: ai.topics,
			tags: ai.tags,
			links: [] as string[],
		}));
	},
}));

const SETTLE_MS = 5000;

function makeFile(path: string): ObsidianTFile {
	const file = new TFile(path);
	const slash = path.lastIndexOf('/');
	if (slash >= 0) {
		file.parent = new TFolder(path.slice(0, slash));
	}
	return file as unknown as ObsidianTFile;
}

/** Build a TFolder tree (for vault.getRoot) from flat directory paths. */
function buildFolderTree(directories: string[]): TFolder {
	const root = new TFolder('/');
	root.isRoot = () => true;
	const map = new Map<string, TFolder>([['/', root]]);

	for (const dir of directories) {
		let current = root;
		let accumulated = '';
		for (const part of dir.split('/').filter(Boolean)) {
			accumulated = accumulated ? `${accumulated}/${part}` : part;
			if (!map.has(accumulated)) {
				const folder = new TFolder(accumulated);
				folder.parent = current;
				map.set(accumulated, folder);
				current.children.push(folder);
			}
			current = map.get(accumulated)!;
		}
	}
	return root;
}

function createMockNotifications() {
	return {
		startOperation: vi.fn().mockReturnValue({
			update: vi.fn(),
			progress: vi.fn(),
			finish: vi.fn(),
			error: vi.fn(),
			cancelled: false,
		}),
		info: vi.fn(),
		success: vi.fn(),
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
	};
}

describe('intake → real organize handshake (#227)', () => {
	let settings: SynapseSettings;
	let store: Map<string, string>;
	let adapterFiles: Map<string, string>;
	let handlers: Record<string, (file: ObsidianTFile) => void>;
	let vault: MockVault;
	let fileManager: MockFileManager;
	let organize: OrganizeModule;
	let intake: IntakeModule;
	let deps: {
		fireOnFile: ReturnType<typeof vi.fn>;
		transcribeUrlToNote: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
		vi.stubGlobal('window', globalThis);

		settings = structuredClone(DEFAULT_SETTINGS);
		settings.intake.enabled = true;
		settings.intake.intakeFolder = 'Inbox';
		settings.intake.markProcessed = true;
		settings.intake.moveWhenDone = '';
		settings.intake.settleSeconds = SETTLE_MS / 1000;
		// captureLog/captureLogFolder keep their defaults (true / '_captured').
		settings.organize.enabled = true;

		ai.topics = [];
		ai.tags = [];

		store = new Map();
		adapterFiles = new Map();
		handlers = {};
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	/**
	 * Build the shared in-memory vault + both REAL modules over a folder tree.
	 * `vault.rename` and `fileManager.renameFile` both mutate `TFile.path` IN
	 * PLACE, exactly as Obsidian does — this is the behaviour intake's move
	 * detection (`originalPath !== file.path`) relies on.
	 */
	async function setup(directories: string[]): Promise<void> {
		const folderRoot = buildFolderTree(directories);

		const adapter = {
			read: vi.fn(async (path: string) => {
				if (!adapterFiles.has(path)) throw new Error(`ENOENT: ${path}`);
				return adapterFiles.get(path)!;
			}),
			write: vi.fn(async (path: string, content: string) => {
				adapterFiles.set(path, content);
			}),
			exists: vi.fn(async (path: string) => {
				if (adapterFiles.has(path)) return true;
				for (const k of adapterFiles.keys()) if (k.startsWith(path + '/')) return true;
				return false;
			}),
			remove: vi.fn(async (path: string) => {
				adapterFiles.delete(path);
			}),
			list: vi.fn(async (folder: string) => ({
				files: [...adapterFiles.keys()].filter((k) => k.startsWith(folder + '/')),
				folders: [],
			})),
		};

		const moveInPlace = (file: ObsidianTFile, newPath: string) => {
			const content = store.get(file.path);
			store.delete(file.path);
			if (content !== undefined) store.set(newPath, content);
			// Obsidian mutates the live TFile on rename — mirror that exactly.
			file.path = newPath;
			file.name = newPath.split('/').pop() ?? newPath;
			file.basename = file.name.replace(/\.[^.]+$/, '');
		};

		vault = {
			on: vi.fn((event: string, cb: (file: ObsidianTFile) => void) => {
				handlers[event] = cb;
				return { event };
			}),
			read: vi.fn(async (file: ObsidianTFile) => store.get(file.path) ?? ''),
			process: vi.fn(async (file: ObsidianTFile, fn: (data: string) => string) => {
				const result = fn(store.get(file.path) ?? '');
				store.set(file.path, result);
				return result;
			}),
			create: vi.fn(async (path: string, content: string) => {
				store.set(path, content);
				return makeFile(path);
			}),
			createFolder: vi.fn().mockResolvedValue(undefined),
			getRoot: () => folderRoot,
			getAbstractFileByPath: vi.fn((path: string) =>
				store.has(path) ? makeFile(path) : null,
			),
			// Organize's primary mover.
			rename: vi.fn(async (file: ObsidianTFile, newPath: string) => moveInPlace(file, newPath)),
			adapter,
		};

		fileManager = {
			// Intake's fallback mover.
			renameFile: vi.fn(async (file: ObsidianTFile, newPath: string) => moveInPlace(file, newPath)),
		};

		const metadataCache = {
			getFileCache: vi.fn().mockReturnValue(null),
			getFirstLinkpathDest: vi.fn().mockReturnValue(null),
		};

		const plugin = {
			app: { vault, fileManager, metadataCache },
			registerEvent: vi.fn(),
			addCommand: vi.fn(),
		};

		organize = new OrganizeModule(
			plugin as unknown as Plugin,
			() => settings,
			createMockNotifications() as never,
			createMockCheckpointManager() as never,
			new CommandRegistrar(plugin),
			() => false, // auto-accept off (default): a proposal never moves the note
		);
		await organize.onload();

		deps = {
			// THE handshake: intake's pipeline phase IS the real organize module.
			fireOnFile: vi.fn(async (file: ObsidianTFile) => {
				await organize.organizeNote(file);
			}),
			transcribeUrlToNote: vi.fn().mockResolvedValue(undefined),
		};

		intake = new IntakeModule(plugin as unknown as Plugin, () => settings, createMockNotifications() as never, deps as never);
		await intake.onload();
	}

	function emit(event: string, path: string, content = ''): ObsidianTFile {
		store.set(path, content);
		const file = makeFile(path);
		handlers[event](file);
		return file;
	}

	function flushDebounce() {
		return vi.runOnlyPendingTimersAsync();
	}

	function capturedBreadcrumbs(): string[] {
		return [...store.keys()].filter((p) => p.startsWith('Inbox/_captured/'));
	}

	describe('high-confidence note with a matching directory', () => {
		beforeEach(async () => {
			await setup(['Inbox', 'Machine Learning']);
			// Confidence 0.95 (≥ 0.9) + an exact existing-directory match → the
			// real DirectoryMatcher scores a direct move out of Inbox.
			ai.topics = [{ label: 'machine learning', confidence: 0.95 }];
			ai.tags = ['#machine-learning'];
		});

		it('moves the note out of Inbox via organize, writes a breadcrumb, applies NO fallback', async () => {
			settings.intake.moveWhenDone = 'Processed'; // would fire only if organize did NOT move it

			emit('create', 'Inbox/note.md', 'A deep dive into neural networks and gradient descent.');
			await flushDebounce();

			// Organize relocated it (the real module called vault.rename).
			expect(vault.rename).toHaveBeenCalledWith(expect.anything(), 'Machine Learning/note.md');
			expect(store.has('Inbox/note.md')).toBe(false);
			expect(store.has('Machine Learning/note.md')).toBe(true);
			expect(store.get('Machine Learning/note.md')).toContain('synapse-processed: true');

			// The moveWhenDone fallback did NOT run — organize already moved it out.
			expect(fileManager.renameFile).not.toHaveBeenCalled();
			expect(store.has('Processed/note.md')).toBe(false);

			// A breadcrumb traces the capture, linking to the organized note.
			const crumb = 'Inbox/_captured/2026-06-05 — note.md';
			expect(store.has(crumb)).toBe(true);
			expect(store.get(crumb)).toContain('[[note]]');
			expect(store.get(crumb)).toContain('from: Inbox/note.md');
			expect(store.get(crumb)).toContain('moved to: Machine Learning/note.md');
		});

		it('does not double-fire fireOnFile and leaves exactly one breadcrumb', async () => {
			emit('create', 'Inbox/note.md', 'Neural networks, transformers, and attention.');
			await flushDebounce();

			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
			expect(capturedBreadcrumbs()).toHaveLength(1);
		});
	});

	describe('low-confidence note (organize keeps it in Inbox)', () => {
		beforeEach(async () => {
			// No directory matches the topic, and confidence is well below the 0.9
			// new-directory threshold → the real matcher returns "keep in place".
			ai.topics = [{ label: 'random musings', confidence: 0.4 }];
			ai.tags = [];
		});

		it('stays in Inbox with NO breadcrumb when moveWhenDone is unset', async () => {
			await setup(['Inbox', 'Projects', 'Archive']);
			settings.intake.moveWhenDone = '';

			emit('create', 'Inbox/thoughts.md', 'Some unstructured stream-of-consciousness notes.');
			await flushDebounce();

			// Neither mover ran; the note is browsable in place, just stamped.
			expect(vault.rename).not.toHaveBeenCalled();
			expect(fileManager.renameFile).not.toHaveBeenCalled();
			expect(store.has('Inbox/thoughts.md')).toBe(true);
			expect(store.get('Inbox/thoughts.md')).toContain('synapse-processed: true');

			// Still in Inbox → nothing to log.
			expect(capturedBreadcrumbs()).toHaveLength(0);
		});

		it('applies the moveWhenDone fallback when organize left it in Inbox', async () => {
			await setup(['Inbox', 'Projects']);
			settings.intake.moveWhenDone = 'Processed';

			emit('create', 'Inbox/thoughts.md', 'Some unstructured stream-of-consciousness notes.');
			await flushDebounce();

			// Organize did NOT move it (its mover was never called)…
			expect(vault.rename).not.toHaveBeenCalled();
			// …so intake's fallback relocates it out of Inbox.
			expect(fileManager.renameFile).toHaveBeenCalledWith(expect.anything(), 'Processed/thoughts.md');
			expect(store.has('Processed/thoughts.md')).toBe(true);
			expect(store.get('Processed/thoughts.md')).toContain('synapse-processed: true');

			// The note left Inbox via the fallback, so per the shipped #224 design
			// ("breadcrumb whenever the note leaves the intake folder") a trace is
			// still written — the breadcrumb is mover-agnostic by design.
			const crumb = 'Inbox/_captured/2026-06-05 — thoughts.md';
			expect(store.has(crumb)).toBe(true);
			expect(store.get(crumb)).toContain('moved to: Processed/thoughts.md');
		});
	});

	describe('TFile.path in-place mutation against the real organize module', () => {
		it('mutates the SAME TFile object in place when organize moves it', async () => {
			await setup(['Inbox', 'Machine Learning']);
			ai.topics = [{ label: 'machine learning', confidence: 0.95 }];
			ai.tags = ['#machine-learning'];

			store.set('Inbox/note.md', 'Neural networks and backpropagation.');
			const file = makeFile('Inbox/note.md');
			const originalPath = file.path; // exactly how intake snapshots it pre-pipeline

			await organize.organizeNote(file);

			// The real module mutated this very object — so intake's
			// `originalPath !== file.path` detection holds against production code.
			expect(originalPath).toBe('Inbox/note.md');
			expect(file.path).toBe('Machine Learning/note.md');
			expect(originalPath).not.toBe(file.path);
			expect(vault.rename).toHaveBeenCalledWith(file, 'Machine Learning/note.md');
		});

		it('does NOT mutate the TFile when organize keeps the note in place', async () => {
			await setup(['Inbox', 'Projects']);
			ai.topics = [{ label: 'random musings', confidence: 0.4 }];
			ai.tags = [];

			store.set('Inbox/keep.md', 'unstructured notes');
			const file = makeFile('Inbox/keep.md');

			await organize.organizeNote(file);

			expect(file.path).toBe('Inbox/keep.md'); // unchanged
			expect(vault.rename).not.toHaveBeenCalled();
		});
	});
});
