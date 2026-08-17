import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plugin, TFile } from 'obsidian';
import { AudioModule } from '../audio';
import { ElaborationModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager, NoteOperationQueue } from '../shared';
import type { CheckpointManager } from '../shared';
import { mockFile, createMockCheckpointManager } from '../__test-utils__/mock-factories';

const AUDIO_EMBED = '![[lecture.m4a]]';
const TRANSCRIPT = 'Kant argues that the categorical imperative is unconditional.';

/** Captures the prompts the elaboration proposer sends. */
const completeMock = vi
	.fn<(...args: unknown[]) => Promise<string>>()
	.mockResolvedValue('Elaborated body');

vi.mock('../shared/ai-client', () => ({
	AIClient: class MockAIClient {
		constructor(_getSettings: unknown) {}
		complete(...args: unknown[]) {
			return completeMock(...args);
		}
	},
}));

/** A promise plus its resolver, to hold the transcription API call open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

/**
 * Vault + adapter backed by mutable in-memory state, so a write by one module
 * is genuinely visible to the next reader (the shared mock vault's `process`
 * does not persist).
 */
function createHarness() {
	const notePath = 'notes/lecture.md';
	const noteFile = mockFile(notePath);
	let noteContent = AUDIO_EMBED;
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
			noteContent = fn(noteContent);
			return noteContent;
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
		app: {
			vault,
			metadataCache: {
				getFileCache: vi.fn(() => null),
				getCache: vi.fn(() => null),
				getFirstLinkpathDest: vi.fn(() => null),
			},
			workspace: {
				getLeavesOfType: vi.fn(() => []),
				getRightLeaf: vi.fn(() => null),
				revealLeaf: vi.fn(),
				getActiveFile: vi.fn(() => noteFile),
			},
		},
		addCommand: vi.fn(),
		registerEvent: vi.fn(),
		loadData: vi.fn(async () => null),
		saveData: vi.fn(async () => undefined),
	};

	return {
		notePath,
		noteFile,
		plugin,
		vault,
		getNoteContent: () => noteContent,
	};
}

interface Modules {
	audio: AudioModule;
	elaboration: ElaborationModule;
	settings: SynapseSettings;
}

/**
 * Build both modules. `queues` decides whether they share one queue (shipped
 * wiring: main.ts passes a single instance) or get their own (the control case
 * standing in for the pre-fix, unserialized code).
 */
function createModules(
	harness: ReturnType<typeof createHarness>,
	queues: { audio: NoteOperationQueue; elaboration: NoteOperationQueue }
): Modules {
	const settings = structuredClone(DEFAULT_SETTINGS);
	// Auto-accept so the elaboration is actually appended to the note and the
	// resulting callouts can be counted.
	settings.autoAccept.elaboration = true;
	const notifications = new NotificationManager();
	const plugin = harness.plugin as unknown as Plugin;

	const audio = new AudioModule(
		plugin,
		() => settings,
		notifications,
		createMockCheckpointManager() as unknown as CheckpointManager,
		queues.audio
	);

	const elaboration = new ElaborationModule(
		plugin,
		() => settings,
		notifications,
		createMockCheckpointManager() as unknown as CheckpointManager,
		new CommandRegistrar(harness.plugin),
		queues.elaboration,
		() => settings.autoAccept.elaboration
	);

	return { audio, elaboration, settings };
}

/** Occurrences of a callout header in the note. */
function countCallouts(content: string, type: string): number {
	return content.split(`> [!${type}]`).length - 1;
}

/** The note body the proposer embedded in its prompt. */
function lastPrompt(): string {
	const calls = completeMock.mock.calls;
	return String(calls[calls.length - 1]?.[0] ?? '');
}

describe('transcription -> elaboration interleaving (#483)', () => {
	let harness: ReturnType<typeof createHarness>;

	beforeEach(() => {
		completeMock.mockClear();
		completeMock.mockResolvedValue('Elaborated body');
		harness = createHarness();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * Start a slow transcription, then submit an elaboration for the same note
	 * before the transcript insert has landed.
	 *
	 * The transcription's API promise is held open across a generous microtask
	 * drain, so an UNSERIALIZED elaboration gets all the turns it needs to read
	 * the note and build its prompt from the pre-insert body. A serialized one is
	 * parked on the queue and simply does nothing during the drain.
	 */
	async function runInterleaved(modules: Modules) {
		const apiCall = deferred<{ raw: string; sourceName: string }>();
		vi.spyOn(modules.audio, 'transcribe').mockImplementation(() => apiCall.promise);

		const transcribing = modules.audio.transcribeAndInsert(
			harness.noteFile as unknown as TFile,
			[{ fileName: 'lecture.m4a', file: mockFile('lecture.m4a') as unknown as TFile, line: 0 }]
		);

		// The user fires Elaborate while the API call is still open.
		await Promise.resolve();
		const elaborating = modules.elaboration.scanNote(harness.noteFile as unknown as TFile);
		for (let i = 0; i < 100; i++) await Promise.resolve();

		apiCall.resolve({ raw: TRANSCRIPT, sourceName: 'lecture.m4a' });
		await Promise.all([transcribing, elaborating]);
	}

	it('serializes the elaboration behind the in-flight transcription insert', async () => {
		const queue = new NoteOperationQueue();
		const modules = createModules(harness, { audio: queue, elaboration: queue });

		await runInterleaved(modules);

		const content = harness.getNoteContent();
		expect(countCallouts(content, 'synapse-transcription')).toBe(1);
		// The corruption in #483 was TWO elaboration callouts, one hallucinated.
		expect(countCallouts(content, 'synapse-elaboration')).toBe(1);
		// The transcript landed first; the elaboration was appended after it.
		expect(content.indexOf('synapse-transcription'))
			.toBeLessThan(content.indexOf('synapse-elaboration'));
	});

	it('elaborates the transcript-inclusive content, not the bare audio embed', async () => {
		const queue = new NoteOperationQueue();
		const modules = createModules(harness, { audio: queue, elaboration: queue });

		await runInterleaved(modules);

		// The proposer's prompt embeds the note body verbatim: it must contain the
		// transcript, which is only possible if it read AFTER the insert landed.
		expect(lastPrompt()).toContain(TRANSCRIPT);
	});

	it('runs post-op hooks against the post-insert content', async () => {
		const queue = new NoteOperationQueue();
		const modules = createModules(harness, { audio: queue, elaboration: queue });

		// Post-op enrichment/title check are fired-and-forgotten from main.ts and
		// acquire the queue themselves; stand in for one and record what a queued
		// follow-up would read.
		const seenByPostOp: string[] = [];
		modules.audio.onTranscriptionComplete = (filePath) => {
			void queue.run(filePath, async () => {
				seenByPostOp.push(await harness.plugin.app.vault.read());
			});
		};

		await runInterleaved(modules);
		// Drain whatever the post-op hook queued behind the primary operations.
		await queue.run(harness.notePath, async () => undefined);

		expect(seenByPostOp).toHaveLength(1);
		expect(seenByPostOp[0]).toContain(TRANSCRIPT);
		// It ran after the elaboration too, so it saw the final note state.
		expect(seenByPostOp[0]).toContain('synapse-elaboration');
	});

	it('CONTROL: without a shared queue the elaboration reads the stale, pre-transcript note', async () => {
		// Separate queues = no cross-feature serialization, i.e. the pre-fix
		// behavior. This is the failure mode #483 reported.
		const modules = createModules(harness, {
			audio: new NoteOperationQueue(),
			elaboration: new NoteOperationQueue(),
		});

		await runInterleaved(modules);

		const prompt = lastPrompt();
		expect(prompt).not.toContain(TRANSCRIPT);
		expect(prompt).toContain(AUDIO_EMBED);
	});
});
