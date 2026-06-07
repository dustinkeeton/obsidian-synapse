import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrganizeModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';

// Each note yields a topic whose RAW label differs ("models" vs "model") but
// canonicalizes to the same key. The matcher proposes a new directory named
// after that raw label, so without batch dedup the two notes would propose two
// different folders.
vi.mock('./content-analyzer', () => ({
	ContentAnalyzer: class MockContentAnalyzer {
		constructor(_app: unknown, _getSettings: unknown) {}
		analyze = vi.fn(async (file: TFile) => ({
			notePath: file.path,
			topics: [
				{ label: file.path.includes('a.md') ? 'models' : 'model', confidence: 0.95 },
			],
			tags: [],
			links: [],
		}));
	},
}));

vi.mock('./directory-matcher', () => ({
	DirectoryMatcher: class MockDirectoryMatcher {
		constructor(_app: unknown) {}
		scoreDirectories = vi.fn().mockReturnValue([]);
		// Propose a new directory named after the (un-normalized) topic label so
		// the dedup pass in OrganizeModule is what coalesces the variants.
		determineAction = vi.fn((analysis: { topics: { label: string }[] }) => ({
			type: 'propose-new-directory',
			targetDirectory: analysis.topics[0].label,
			reasoning: 'new directory',
		}));
	},
}));

/** In-memory adapter so OrganizeStore round-trips proposals via JSON. */
function createMemoryAdapter() {
	const files = new Map<string, string>();
	return {
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

describe('OrganizeModule batch dedup (#172)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let settings: SynapseSettings;
	let notifications: NotificationManager;
	let mockPlugin: { app: Record<string, unknown>; addCommand: ReturnType<typeof vi.fn>; registerEvent: ReturnType<typeof vi.fn> };
	let files: TFile[];

	beforeEach(() => {
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = new NotificationManager();
		files = [new TFile('inbox/a.md'), new TFile('inbox/b.md')];

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# Note\n\nbody'),
					rename: vi.fn().mockResolvedValue(undefined),
					createFolder: vi.fn().mockResolvedValue(undefined),
					getMarkdownFiles: vi.fn().mockReturnValue(files),
					getAbstractFileByPath: vi.fn(() => null),
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

	it('coalesces singular/plural proposals across a scan to one directory', async () => {
		const mod = new OrganizeModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			() => false // auto-accept off: proposals stay pending for inspection
		);
		await mod.onload();

		// skipConfirmation = true to bypass the interactive modal.
		await mod.scanDirectory(undefined, true);

		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(2);

		// Both notes resolve to a single proposed directory despite differing
		// raw topic labels ("models" vs "model").
		const dirs = new Set(pending.map(p => p.proposedDirectory));
		expect(dirs.size).toBe(1);
	});
});
