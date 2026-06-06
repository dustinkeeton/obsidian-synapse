import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntakeModule } from './index';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { TFile, TFolder } from '../__mocks__/obsidian';

// Mock only the article fetcher from shared; everything else (parseFrontmatter,
// serializeFrontmatter, ensureFolder, classifyUrl, extractUrls) uses the real
// implementation so routing + frontmatter behaviour is exercised end-to-end.
vi.mock('../shared', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../shared')>();
	return {
		...actual,
		fetchArticleContent: vi.fn().mockResolvedValue('FETCHED ARTICLE BODY'),
	};
});

import { fetchArticleContent } from '../shared';

const DEBOUNCE_MS = 400;

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
	};
}

/**
 * Build a TFile whose `.parent` is a real TFolder, mirroring how Obsidian
 * populates events. extension/name/basename are derived by the mock TFile ctor.
 */
function makeFile(path: string): TFile {
	const file = new TFile(path);
	const slash = path.lastIndexOf('/');
	if (slash >= 0) {
		file.parent = new TFolder(path.slice(0, slash));
	}
	return file;
}

describe('IntakeModule', () => {
	let module: IntakeModule;
	let plugin: any;
	let notifications: ReturnType<typeof createMockNotifications>;
	let settings: SynapseSettings;
	let deps: {
		fireOnFile: ReturnType<typeof vi.fn>;
		elaborateFile: ReturnType<typeof vi.fn>;
		transcribeUrlToNote: ReturnType<typeof vi.fn>;
	};
	/** Captured vault event handlers, keyed by event name. */
	let handlers: Record<string, (file: any) => void>;
	/** In-memory file content, keyed by path. */
	let store: Map<string, string>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-05T12:00:00.000Z'));
		// The module uses window.setTimeout (Obsidian/Electron idiom, matching
		// elaboration). Under the node test env there is no window, so point it
		// at globalThis whose timers vitest's fake timers control.
		vi.stubGlobal('window', globalThis);

		settings = structuredClone(DEFAULT_SETTINGS);
		settings.intake.enabled = true;
		settings.intake.intakeFolder = 'Inbox';
		settings.intake.markProcessed = true;
		settings.intake.moveWhenDone = '';

		handlers = {};
		store = new Map();

		const vault = {
			on: vi.fn((event: string, cb: (file: any) => void) => {
				handlers[event] = cb;
				return { event };
			}),
			read: vi.fn(async (file: any) => store.get(file.path) ?? ''),
			modify: vi.fn(async (file: any, content: string) => {
				store.set(file.path, content);
			}),
			create: vi.fn(),
			createFolder: vi.fn().mockResolvedValue(undefined),
			getAbstractFileByPath: vi.fn((path: string) => {
				if (store.has(path)) return makeFile(path);
				return null;
			}),
		};

		const fileManager = {
			renameFile: vi.fn(async (file: any, newPath: string) => {
				const content = store.get(file.path);
				store.delete(file.path);
				if (content !== undefined) store.set(newPath, content);
				file.path = newPath;
			}),
		};

		plugin = {
			app: { vault, fileManager },
			registerEvent: vi.fn(),
		};

		notifications = createMockNotifications();
		deps = {
			fireOnFile: vi.fn().mockResolvedValue(undefined),
			elaborateFile: vi.fn().mockResolvedValue(undefined),
			transcribeUrlToNote: vi.fn().mockResolvedValue(undefined),
		};

		module = new IntakeModule(plugin, () => settings, notifications as any, deps as any);
		(fetchArticleContent as any).mockClear();
		(fetchArticleContent as any).mockResolvedValue('FETCHED ARTICLE BODY');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	/** Seed a file and dispatch a synthetic 'create' event for it. */
	function emit(event: string, path: string, content = '') {
		store.set(path, content);
		const file = makeFile(path);
		handlers[event](file);
		return file;
	}

	/** Run all pending timers, then drain microtasks so async flush settles. */
	async function flushDebounce() {
		await vi.runOnlyPendingTimersAsync();
	}

	describe('onload / listener registration', () => {
		it('registers create and modify listeners when enabled', async () => {
			await module.onload();
			expect(plugin.app.vault.on).toHaveBeenCalledWith('create', expect.any(Function));
			expect(plugin.app.vault.on).toHaveBeenCalledWith('modify', expect.any(Function));
			expect(plugin.registerEvent).toHaveBeenCalledTimes(2);
		});

		it('registers no listeners when intake is disabled', async () => {
			settings.intake.enabled = false;
			await module.onload();
			expect(plugin.app.vault.on).not.toHaveBeenCalled();
		});
	});

	describe('event filtering', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('ignores non-markdown files', async () => {
			emit('create', 'Inbox/image.png', 'binary');
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});

		it('ignores files outside the intake folder', async () => {
			emit('create', 'Projects/note.md', 'hello');
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});

		it('accepts a note in a subfolder of the intake folder', async () => {
			emit('create', 'Inbox/sub/deep.md', 'hello prose');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('does nothing when intake is disabled at event time', async () => {
			settings.intake.enabled = false;
			emit('create', 'Inbox/note.md', 'hello');
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});

		it('never watches the whole vault when the intake folder is empty', async () => {
			settings.intake.intakeFolder = '';
			emit('create', 'note.md', 'hello');
			emit('create', 'Anywhere/note.md', 'hello');
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});
	});

	describe('debounce coalescing', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('coalesces a create + immediate modify of the same path into one flush', async () => {
			const path = 'Inbox/capture.md';
			store.set(path, 'hello prose');
			handlers['create'](makeFile(path));
			handlers['modify'](makeFile(path));
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('flushes two distinct paths separately', async () => {
			store.set('Inbox/a.md', 'note a');
			store.set('Inbox/b.md', 'note b');
			handlers['create'](makeFile('Inbox/a.md'));
			handlers['create'](makeFile('Inbox/b.md'));
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(2);
		});

		it('resets the debounce window on a subsequent event within the window', async () => {
			const path = 'Inbox/capture.md';
			store.set(path, 'hello prose');
			handlers['create'](makeFile(path));

			// Advance partway, then fire again to reset the timer.
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
			expect(deps.fireOnFile).not.toHaveBeenCalled();
			handlers['modify'](makeFile(path));

			// The original deadline passes but the timer was reset → still no flush.
			await vi.advanceTimersByTimeAsync(150);
			expect(deps.fireOnFile).not.toHaveBeenCalled();

			// After the full window from the reset, it flushes exactly once.
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('does not flush after onunload clears pending timers', async () => {
			const path = 'Inbox/capture.md';
			store.set(path, 'hello prose');
			handlers['create'](makeFile(path));
			module.onunload();
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});
	});

	describe('processed-flag idempotency', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('skips a note already stamped synapse-processed: true', async () => {
			const content = '---\nsynapse-processed: true\n---\nhello prose';
			emit('create', 'Inbox/done.md', content);
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});

		it('stamps synapse-processed after a successful general run', async () => {
			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();

			const written = store.get('Inbox/note.md')!;
			expect(written).toContain('synapse-processed: true');
			expect(written).toContain('synapse-processed-at:');
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('does not reprocess on the modify echo from its own stamp write', async () => {
			const path = 'Inbox/note.md';
			emit('create', path, 'hello prose');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);

			// Simulate Obsidian emitting a modify for our own stamp write.
			handlers['modify'](makeFile(path));
			await flushDebounce();
			// The stamped note is now idempotent → still exactly one run.
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('does not stamp when markProcessed is false', async () => {
			settings.intake.markProcessed = false;
			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();
			expect(store.get('Inbox/note.md')).not.toContain('synapse-processed');
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('does not stamp when processing throws (note stays retriable)', async () => {
			deps.fireOnFile.mockRejectedValueOnce(new Error('boom'));
			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();
			expect(store.get('Inbox/note.md')).not.toContain('synapse-processed');
			expect(notifications.notifyError).toHaveBeenCalled();
		});
	});

	describe('dispatch routing → processing', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('bare video URL → transcription stub (no fire, no fetch)', async () => {
			emit('create', 'Inbox/vid.md', 'https://www.youtube.com/watch?v=abc');
			await flushDebounce();
			expect(deps.transcribeUrlToNote).toHaveBeenCalledWith(
				'https://www.youtube.com/watch?v=abc',
				'video',
				expect.anything()
			);
			expect(deps.fireOnFile).not.toHaveBeenCalled();
			expect(fetchArticleContent).not.toHaveBeenCalled();
		});

		it('bare audio URL → transcription stub with mediaType audio', async () => {
			emit('create', 'Inbox/pod.md', 'https://open.spotify.com/episode/xyz');
			await flushDebounce();
			expect(deps.transcribeUrlToNote).toHaveBeenCalledWith(
				'https://open.spotify.com/episode/xyz',
				'audio',
				expect.anything()
			);
		});

		it('bare article URL → fetch + append + elaborate', async () => {
			emit('create', 'Inbox/art.md', 'https://example.com/post');
			await flushDebounce();

			expect(fetchArticleContent).toHaveBeenCalledWith('https://example.com/post');
			const written = store.get('Inbox/art.md')!;
			expect(written).toContain('FETCHED ARTICLE BODY');
			expect(deps.elaborateFile).toHaveBeenCalledTimes(1);
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});

		it('bare unknown URL → general pipeline', async () => {
			emit('create', 'Inbox/u.md', 'https://example.com/wiki/Obsidian_(software)');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
			expect(deps.transcribeUrlToNote).not.toHaveBeenCalled();
			expect(fetchArticleContent).not.toHaveBeenCalled();
		});

		it('prose → general pipeline', async () => {
			emit('create', 'Inbox/p.md', 'Some plain prose note.');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('multiple URLs → general pipeline', async () => {
			emit('create', 'Inbox/m.md', 'https://a.com/x\nhttps://b.com/y');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
			expect(fetchArticleContent).not.toHaveBeenCalled();
		});
	});

	describe('move when done', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('stamps BEFORE moving the note', async () => {
			settings.intake.moveWhenDone = 'Processed';
			const order: string[] = [];

			plugin.app.vault.modify.mockImplementation(async (file: any, content: string) => {
				if (content.includes('synapse-processed: true')) order.push('stamp');
				store.set(file.path, content);
			});
			plugin.app.fileManager.renameFile.mockImplementation(async (file: any, newPath: string) => {
				order.push('move');
				const content = store.get(file.path);
				store.delete(file.path);
				if (content !== undefined) store.set(newPath, content);
				file.path = newPath;
			});

			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();

			expect(order).toEqual(['stamp', 'move']);
		});

		it('moves the note into the destination folder, ensuring it exists', async () => {
			settings.intake.moveWhenDone = 'Processed';
			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();

			expect(plugin.app.vault.createFolder).toHaveBeenCalledWith('Processed');
			expect(plugin.app.fileManager.renameFile).toHaveBeenCalledWith(
				expect.anything(),
				'Processed/note.md'
			);
			expect(store.has('Processed/note.md')).toBe(true);
		});

		it('does not move when moveWhenDone is empty', async () => {
			settings.intake.moveWhenDone = '';
			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();
			expect(plugin.app.fileManager.renameFile).not.toHaveBeenCalled();
		});
	});

	describe('flush resilience', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('drops a note that vanished before flush', async () => {
			const path = 'Inbox/gone.md';
			handlers['create'](makeFile(path)); // never seeded into store
			await flushDebounce();
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});
	});
});
