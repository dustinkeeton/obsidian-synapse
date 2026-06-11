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

// The settle window is now driven by `intake.settleSeconds` (#222). Tests seed
// `settings.intake.settleSeconds = 5` (the default), so the effective debounce
// is 5000ms; this local constant mirrors that so the timing assertions read
// clearly. Individual tests override `settleSeconds` to exercise the setting.
const SETTLE_MS = 5000;

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
		settings.intake.settleSeconds = SETTLE_MS / 1000;

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
			// Atomic read -> transform -> write against the in-memory store
			// (mirrors Obsidian's Vault.process).
			process: vi.fn(async (file: any, fn: (data: string) => string) => {
				const result = fn(store.get(file.path) ?? '');
				store.set(file.path, result);
				return result;
			}),
			create: vi.fn(async (path: string, content: string) => {
				store.set(path, content);
				return makeFile(path);
			}),
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

	/**
	 * Make `fireOnFile` simulate organize relocating the note: move its content
	 * in the store and mutate `file.path` in place, exactly as organize's
	 * `vault.rename` does. Pass `null` to model organize keeping the note in
	 * place (low confidence → proposal / no-op) — content/path are untouched.
	 */
	function organizeMovesTo(newPath: string | null) {
		deps.fireOnFile.mockImplementation(async (file: any) => {
			if (newPath === null || newPath === file.path) return;
			const content = store.get(file.path);
			store.delete(file.path);
			if (content !== undefined) store.set(newPath, content);
			file.path = newPath;
		});
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
			await vi.advanceTimersByTimeAsync(SETTLE_MS - 100);
			expect(deps.fireOnFile).not.toHaveBeenCalled();
			handlers['modify'](makeFile(path));

			// The original deadline passes but the timer was reset → still no flush.
			await vi.advanceTimersByTimeAsync(150);
			expect(deps.fireOnFile).not.toHaveBeenCalled();

			// After the full window from the reset, it flushes exactly once.
			await vi.advanceTimersByTimeAsync(SETTLE_MS);
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

	describe('settle window (#222)', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('keeps deferring while edits keep arriving inside the window', async () => {
			const path = 'Inbox/capture.md';
			store.set(path, 'draft');
			handlers['create'](makeFile(path));

			// Five edits, each just before the window would elapse. Every edit
			// resets the timer, so the note never gets processed mid-write.
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
				expect(deps.fireOnFile).not.toHaveBeenCalled();
				handlers['modify'](makeFile(path));
			}

			// Still nothing — the last edit just reset the timer again.
			expect(deps.fireOnFile).not.toHaveBeenCalled();
		});

		it('fires exactly once, settleSeconds after the last edit', async () => {
			const path = 'Inbox/capture.md';
			store.set(path, 'hello prose');
			handlers['create'](makeFile(path));

			// A burst of edits within the window…
			await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
			handlers['modify'](makeFile(path));
			await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
			handlers['modify'](makeFile(path));

			// One tick short of the window after the final edit → not yet.
			await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
			expect(deps.fireOnFile).not.toHaveBeenCalled();

			// Crossing the window from the last edit fires it once.
			await vi.advanceTimersByTimeAsync(1);
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('respects a custom settleSeconds setting', async () => {
			settings.intake.settleSeconds = 12;
			const path = 'Inbox/slow.md';
			store.set(path, 'hello prose');
			handlers['create'](makeFile(path));

			// The old 5s window elapses with no flush — we now wait 12s.
			await vi.advanceTimersByTimeAsync(5000);
			expect(deps.fireOnFile).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(7000);
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('falls back to a sane window when settleSeconds is invalid', async () => {
			// A malformed setting (0 / NaN / undefined) must not disable the
			// watcher — it falls back to DEBOUNCE_MS (5000ms).
			(settings.intake as any).settleSeconds = 0;
			const path = 'Inbox/fallback.md';
			store.set(path, 'hello prose');
			handlers['create'](makeFile(path));

			await vi.advanceTimersByTimeAsync(4999);
			expect(deps.fireOnFile).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
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

		it('bare article URL → fetch + append + full pipeline (#223)', async () => {
			emit('create', 'Inbox/art.md', 'https://example.com/post');
			await flushDebounce();

			expect(fetchArticleContent).toHaveBeenCalledWith('https://example.com/post');
			const written = store.get('Inbox/art.md')!;
			expect(written).toContain('FETCHED ARTICLE BODY');
			// The article branch now runs the whole pipeline (fireOnFile), whose
			// organize phase relocates the note — there is no elaborate-only path.
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
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

			plugin.app.vault.process.mockImplementation(async (file: any, fn: (data: string) => string) => {
				const content = fn(store.get(file.path) ?? '');
				if (content.includes('synapse-processed: true')) order.push('stamp');
				store.set(file.path, content);
				return content;
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

	describe('full pipeline + auto-organize (#223)', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('runs the full pipeline on an article note and organizes it out of Inbox', async () => {
			// Organize (pipeline phase) relocates the fleshed-out article note.
			organizeMovesTo('Articles/art.md');

			emit('create', 'Inbox/art.md', 'https://example.com/post');
			await flushDebounce();

			expect(fetchArticleContent).toHaveBeenCalledWith('https://example.com/post');
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
			// The note left Inbox and landed where organize put it, stamped.
			expect(store.has('Inbox/art.md')).toBe(false);
			const moved = store.get('Articles/art.md')!;
			expect(moved).toContain('FETCHED ARTICLE BODY');
			expect(moved).toContain('synapse-processed: true');
		});

		it('does NOT apply moveWhenDone when organize already moved the note out (no double move)', async () => {
			settings.intake.moveWhenDone = 'Processed';
			organizeMovesTo('Articles/note.md'); // organize relocates it

			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();

			// Fallback mover must not fire — organize already moved it out.
			expect(plugin.app.fileManager.renameFile).not.toHaveBeenCalled();
			expect(store.has('Processed/note.md')).toBe(false);
			expect(store.has('Articles/note.md')).toBe(true);
		});

		it('applies moveWhenDone as a fallback when organize keeps the note in Inbox', async () => {
			settings.intake.moveWhenDone = 'Processed';
			organizeMovesTo(null); // low confidence → organize keeps it in place

			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();

			// Note never left Inbox via organize → fallback relocates it.
			expect(plugin.app.fileManager.renameFile).toHaveBeenCalledWith(
				expect.anything(),
				'Processed/note.md'
			);
			expect(store.has('Processed/note.md')).toBe(true);
			expect(store.get('Processed/note.md')).toContain('synapse-processed: true');
		});

		it('does not re-enter flush after organize moves the note OUT of Inbox', async () => {
			organizeMovesTo('Articles/note.md');

			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);

			// The post-organize stamp write lands on the NEW path. Obsidian emits
			// a modify for it; isInIntakeFolder rejects it (outside Inbox).
			handlers['modify'](makeFile('Articles/note.md'));
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});

		it('does not re-enter flush when organize keeps the note IN Inbox', async () => {
			organizeMovesTo(null); // stays at Inbox/note.md

			emit('create', 'Inbox/note.md', 'hello prose');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);

			// Stamp echo on the original in-Inbox path → idempotency guard skips it.
			handlers['modify'](makeFile('Inbox/note.md'));
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1);
		});
	});

	describe('capture log breadcrumb (#224)', () => {
		beforeEach(async () => {
			await module.onload();
		});

		it('writes a dated breadcrumb linking to the new path when organized out of Inbox', async () => {
			organizeMovesTo('Articles/My Note.md');

			emit('create', 'Inbox/My Note.md', 'hello prose');
			await flushDebounce();

			// setSystemTime is 2026-06-05, so the breadcrumb is date-named for it.
			const crumbPath = 'Inbox/_captured/2026-06-05 — My Note.md';
			expect(store.has(crumbPath)).toBe(true);
			const crumb = store.get(crumbPath)!;
			// Links to the moved note by basename, and records the trail.
			expect(crumb).toContain('[[My Note]]');
			expect(crumb).toContain('from: Inbox/My Note.md');
			expect(crumb).toContain('moved to: Articles/My Note.md');
			// Stamped as defense-in-depth so it is never reprocessed.
			expect(crumb).toContain('synapse-processed: true');
		});

		it('sanitizes the breadcrumb filename', async () => {
			organizeMovesTo('Refs/Weird: Title*?.md');

			emit('create', 'Inbox/Weird: Title*?.md', 'hello prose');
			await flushDebounce();

			// Illegal filename chars are stripped (the video sanitize rule).
			expect(store.has('Inbox/_captured/2026-06-05 — Weird Title.md')).toBe(true);
		});

		it('writes no breadcrumb when the note is not moved out of Inbox', async () => {
			organizeMovesTo(null); // organize keeps it in place

			emit('create', 'Inbox/stay.md', 'hello prose');
			await flushDebounce();

			const captured = [...store.keys()].filter((p) => p.startsWith('Inbox/_captured/'));
			expect(captured).toHaveLength(0);
		});

		it('writes no breadcrumb when captureLog is disabled', async () => {
			settings.intake.captureLog = false;
			organizeMovesTo('Articles/off.md');

			emit('create', 'Inbox/off.md', 'hello prose');
			await flushDebounce();

			expect(store.has('Articles/off.md')).toBe(true); // still organized
			const captured = [...store.keys()].filter((p) => p.startsWith('Inbox/_captured/'));
			expect(captured).toHaveLength(0);
		});

		it('IGNORES a file created in the capture-log subfolder (no reprocessing / no loop)', async () => {
			// A breadcrumb (or anything) appearing under Inbox/_captured must be
			// invisible to the watcher — otherwise the watcher would re-ingest its
			// own breadcrumbs and spin forever.
			emit('create', 'Inbox/_captured/2026-06-05 — Something.md', '[[Something]]');
			emit('modify', 'Inbox/_captured/2026-06-05 — Something.md', '[[Something]]');
			await flushDebounce();

			expect(deps.fireOnFile).not.toHaveBeenCalled();
			expect(deps.transcribeUrlToNote).not.toHaveBeenCalled();
			expect(fetchArticleContent).not.toHaveBeenCalled();
		});

		it('respects a custom captureLogFolder for both writing and exclusion', async () => {
			settings.intake.captureLogFolder = 'log';
			organizeMovesTo('Articles/custom.md');

			emit('create', 'Inbox/custom.md', 'hello prose');
			await flushDebounce();
			expect(store.has('Inbox/log/2026-06-05 — custom.md')).toBe(true);

			// And the custom subfolder is excluded from the watcher.
			emit('create', 'Inbox/log/2026-06-05 — custom.md', 'x');
			await flushDebounce();
			expect(deps.fireOnFile).toHaveBeenCalledTimes(1); // only the original run
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
