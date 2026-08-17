import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plugin, TFile } from 'obsidian';
import { TidyModule } from './index';
import { AudioModule } from '../audio';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NoteOperationQueue } from '../shared';
import type { CheckpointManager, NotificationManager } from '../shared';
import { mockFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';

/**
 * Regression: a whole-note rewrite must not clobber a concurrent insert (#483).
 *
 * Tidy is the sharpest case in the codebase. It reads the entire note, spends
 * seconds in an AI call, then writes the result back over the WHOLE note
 * (`vault.process(file, () => cleaned)`). Run while a transcription is in
 * flight for the same note, an unserialized tidy silently deletes the
 * transcript: its pre-AI snapshot never contained the callout, and its write
 * replaces everything.
 *
 * The CONTROL case at the bottom drives the identical scenario with the two
 * modules on SEPARATE queues — the pre-#483 topology — and asserts the
 * transcript is lost. That is what makes the assertions above meaningful.
 */

const AUDIO_EMBED = '![[lecture.m4a]]';
const TRANSCRIPT = 'Kant argues that the categorical imperative is unconditional.';

/** Captures what tidy sent to the model, and echoes the body back as the "tidied" note. */
const completeMock = vi.fn<(...args: unknown[]) => Promise<string>>();

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		constructor(_getSettings: unknown) {}
		complete(...args: unknown[]) {
			return completeMock(...args);
		}
	},
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

function createMockNotifications() {
	return {
		startOperation: vi.fn(() => ({
			update: vi.fn(),
			progress: vi.fn(),
			finish: vi.fn(),
			error: vi.fn(),
			cancelled: false,
		})),
		info: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		notifyError: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
	};
}

/**
 * Vault backed by mutable in-memory state so one module's write is genuinely
 * visible to the next reader, plus an in-memory adapter for the tidy snapshot
 * store. Records the order of note writes.
 */
function createHarness() {
	const notePath = 'notes/lecture.md';
	const noteFile = mockFile(notePath);
	let noteContent = AUDIO_EMBED;
	const writeOrder: string[] = [];
	const dataFiles = new Map<string, string>();

	const adapter = {
		read: vi.fn(async (path: string) => {
			const value = dataFiles.get(path);
			if (value === undefined) throw new Error(`ENOENT: ${path}`);
			return value;
		}),
		write: vi.fn(async (path: string, content: string) => { dataFiles.set(path, content); }),
		exists: vi.fn(async (path: string) => dataFiles.has(path) || path.startsWith('.synapse')),
		remove: vi.fn(async (path: string) => { dataFiles.delete(path); }),
		list: vi.fn(async (folder: string) => ({
			files: [...dataFiles.keys()].filter((f) => f.startsWith(`${folder}/`)),
			folders: [],
		})),
	};

	const vault = {
		read: vi.fn(async () => noteContent),
		cachedRead: vi.fn(async () => noteContent),
		process: vi.fn(async (_file: TFile, fn: (data: string) => string) => {
			const next = fn(noteContent);
			writeOrder.push(next.includes('TIDIED:') ? 'tidy' : 'transcription');
			noteContent = next;
			return next;
		}),
		modify: vi.fn(async () => undefined),
		create: vi.fn(),
		createFolder: vi.fn(async () => undefined),
		getAbstractFileByPath: vi.fn((path: string) => (path === notePath ? noteFile : null)),
		getMarkdownFiles: vi.fn(() => [noteFile]),
		readBinary: vi.fn(async () => new ArrayBuffer(8)),
		adapter,
	};

	const plugin = {
		app: { vault, fileManager: { trashFile: vi.fn() } },
		addCommand: vi.fn(),
		registerEvent: vi.fn(),
		loadData: vi.fn(async () => null),
		saveData: vi.fn(async () => undefined),
	};

	return { notePath, noteFile, plugin, getNoteContent: () => noteContent, writeOrder };
}

interface Modules {
	audio: AudioModule;
	tidy: TidyModule;
	settings: SynapseSettings;
}

function createModules(
	harness: ReturnType<typeof createHarness>,
	queues: { audio: NoteOperationQueue; tidy: NoteOperationQueue }
): Modules {
	const settings = structuredClone(DEFAULT_SETTINGS);
	const notifications = createMockNotifications() as unknown as NotificationManager;
	const plugin = harness.plugin as unknown as Plugin;

	const audio = new AudioModule(
		plugin,
		() => settings,
		notifications,
		createMockCheckpointManager() as unknown as CheckpointManager,
		queues.audio
	);

	const tidy = new TidyModule(
		plugin,
		() => settings,
		notifications,
		new CommandRegistrar(harness.plugin),
		queues.tidy
	);

	return { audio, tidy, settings };
}

describe('tidy vs. in-flight transcription (#483)', () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		completeMock.mockClear();
		harness = createHarness();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** Let every already-runnable continuation proceed. */
	async function drain() {
		for (let i = 0; i < 100; i++) await Promise.resolve();
	}

	/**
	 * Start a slow transcription, then submit Tidy for the same note before the
	 * transcript insert has landed. BOTH AI calls are held open — as they are in
	 * production, where each takes seconds — and released transcription-first, so
	 * an unserialized tidy reads the note early and writes LAST, over content it
	 * never saw. A serialized tidy is parked on the queue for the whole window
	 * and reads only after the insert lands.
	 *
	 * Returns the note body tidy actually sent to the model.
	 */
	async function runInterleaved(modules: Modules): Promise<string> {
		const apiCall = deferred<{ raw: string; sourceName: string }>();
		const tidyGate = deferred<void>();
		let tidyPrompt = '';

		vi.spyOn(modules.audio, 'transcribe').mockImplementation(() => apiCall.promise);
		completeMock.mockImplementation(async (body: unknown) => {
			tidyPrompt = String(body);
			await tidyGate.promise;
			return `TIDIED: ${String(body)}`;
		});

		const transcribing = modules.audio.transcribeAndInsert(
			harness.noteFile as unknown as TFile,
			[{ fileName: 'lecture.m4a', file: mockFile('lecture.m4a') as unknown as TFile, line: 0 }]
		);

		await Promise.resolve();
		const tidying = modules.tidy.tidy(harness.noteFile as unknown as TFile);
		await drain();                                                  // tidy reaches its AI call (if unqueued)

		apiCall.resolve({ raw: TRANSCRIPT, sourceName: 'lecture.m4a' });
		await drain();                                                  // the transcript insert lands

		tidyGate.resolve();                                             // only now does tidy write
		await Promise.all([transcribing, tidying]);
		return tidyPrompt;
	}

	it('serializes the tidy behind the transcript insert, preserving both writes', async () => {
		const queue = new NoteOperationQueue();
		const modules = createModules(harness, { audio: queue, tidy: queue });

		await runInterleaved(modules);

		const content = harness.getNoteContent();
		// Tidy ran, and the transcript it rewrote around survived.
		expect(content).toContain('TIDIED:');
		expect(content).toContain(TRANSCRIPT);
		// Submission order: the transcription held the slot, so it wrote first.
		expect(harness.writeOrder).toEqual(['transcription', 'tidy']);
	});

	it('tidies the transcript-inclusive body, not the bare audio embed', async () => {
		const queue = new NoteOperationQueue();
		const modules = createModules(harness, { audio: queue, tidy: queue });

		// The prompt is the note body as tidy read it — only post-insert content
		// can contain the transcript.
		const prompt = await runInterleaved(modules);
		expect(prompt).toContain(TRANSCRIPT);
	});

	it('CONTROL: without a shared queue the tidy rewrite destroys the transcript', async () => {
		// Separate queues = no cross-feature serialization, i.e. the pre-fix
		// behavior: tidy reads before the insert and its whole-note write then
		// replaces content it never saw.
		const modules = createModules(harness, {
			audio: new NoteOperationQueue(),
			tidy: new NoteOperationQueue(),
		});

		const prompt = await runInterleaved(modules);

		expect(prompt).toContain(AUDIO_EMBED);
		expect(prompt).not.toContain(TRANSCRIPT);          // read the stale body
		const content = harness.getNoteContent();
		expect(content).toContain('TIDIED:');
		expect(content).not.toContain(TRANSCRIPT);         // lost update: transcript gone
	});
});
