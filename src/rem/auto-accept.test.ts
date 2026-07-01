import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { RemLinkCandidate } from './types';

// Fixed literal candidate the scanner "finds" — two occurrences of one term.
const CANDIDATE: RemLinkCandidate = {
	targetPath: 'Concepts/Backpropagation.md',
	targetDisplayName: 'Backpropagation',
	matchedText: 'backpropagation',
	matchType: 'title',
	occurrences: [
		{ lineNumber: 0, lineText: 'about backpropagation', startOffset: 6, endOffset: 21 },
	],
	confidence: 1.0,
};

vi.mock('./mention-scanner', () => ({
	MentionScanner: class MockMentionScanner {
		constructor(_app: unknown) {}
		scan = vi.fn().mockReturnValue([CANDIDATE]);
	},
}));

// Applier returns a sentinel so we can confirm the accept path wrote it.
vi.mock('./rem-applier', () => ({
	RemApplier: class MockRemApplier {
		apply = vi.fn().mockReturnValue('CONTENT WITH [[Backpropagation]] LINK');
	},
}));

vi.mock('./semantic-matcher', () => ({
	SemanticMatcher: class MockSemanticMatcher {
		constructor(_app: unknown, _getSettings: unknown) {}
		match = vi.fn().mockResolvedValue([]);
	},
}));

/** In-memory adapter so RemStore round-trips proposals via JSON. */
function createMemoryAdapter() {
	const files = new Map<string, string>();
	return {
		_files: files,
		read: vi.fn(async (path: string) => {
			if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
			return files.get(path)!;
		}),
		write: vi.fn(async (path: string, content: string) => {
			files.set(path, content);
		}),
		exists: vi.fn(async (path: string) => {
			if (files.has(path)) return true;
			for (const key of files.keys()) if (key.startsWith(path + '/')) return true;
			return false;
		}),
		remove: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		list: vi.fn(async (folder: string) => {
			const out: string[] = [];
			for (const key of files.keys()) if (key.startsWith(folder + '/')) out.push(key);
			return { files: out, folders: [] };
		}),
	};
}

describe('RemModule auto-accept (#228)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: { app: Record<string, unknown>; addCommand: ReturnType<typeof vi.fn>; registerEvent: ReturnType<typeof vi.fn> };
	let settings: SynapseSettings;
	let notifications: NotificationManager;
	let processSpy: ReturnType<typeof vi.fn>;
	let sourceFile: TFile;

	beforeEach(() => {
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = new NotificationManager();
		const readSpy = vi
			.fn<(file: unknown) => Promise<string>>()
			.mockResolvedValue('# ML\n\nThis note is about backpropagation in depth.');
		// Atomic read -> transform -> write; the callback's return value is the
		// written content (mirrors Obsidian's Vault.process).
		processSpy = vi.fn(async (file: unknown, fn: (data: string) => string) =>
			fn(await readSpy(file))
		);
		sourceFile = new TFile('notes/ml.md');

		mockPlugin = {
			app: {
				vault: {
					read: readSpy,
					modify: vi.fn().mockResolvedValue(undefined),
					process: processSpy,
					createFolder: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn((path: string) =>
						path === 'notes/ml.md' ? sourceFile : null
					),
					adapter,
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
				},
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(shouldAutoAccept: () => boolean): RemModule {
		return new RemModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			shouldAutoAccept
		);
	}

	it('auto-accepts a freshly generated REM proposal, inserting all candidate links', async () => {
		settings.autoAccept.rem = true;
		const mod = build(() => settings.autoAccept.rem);
		await mod.onload();

		await mod.remScanNote('notes/ml.md');

		// The note body was rewritten with the applied links.
		expect(processSpy).toHaveBeenCalledTimes(1);
		expect(await processSpy.mock.results[0].value).toBe('CONTENT WITH [[Backpropagation]] LINK');

		// Nothing left pending.
		expect(await mod.getPendingProposals()).toHaveLength(0);
	});

	it('leaves the REM proposal pending and does not modify the note when the flag is off', async () => {
		settings.autoAccept.rem = false;
		const mod = build(() => settings.autoAccept.rem);
		await mod.onload();

		await mod.remScanNote('notes/ml.md');

		expect(processSpy).not.toHaveBeenCalled();
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe('pending');
		expect(pending[0].candidates).toHaveLength(1);
	});
});
