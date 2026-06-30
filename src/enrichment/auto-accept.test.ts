import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EnrichmentModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager } from '../shared';
import { TFile } from '../__mocks__/obsidian';
import { createMockCheckpointManager } from '../__test-utils__/mock-factories';
import type { EnrichmentProposal, AcceptedItems } from './types';

// Deterministic enrichment result: one tag, one internal link, one frontmatter key.
vi.mock('./vault-analyzer', () => ({
	VaultAnalyzer: class MockVaultAnalyzer {
		constructor(_app: unknown) {}
		invalidate = vi.fn();
		getFileTags = vi.fn().mockReturnValue([]);
		getOutgoingLinks = vi.fn().mockReturnValue(new Set<string>());
		buildTagIndex = vi.fn();
		buildLinkGraph = vi.fn();
	},
}));

vi.mock('./metadata-classifier', () => ({
	MetadataClassifier: class MockMetadataClassifier {
		constructor(_getSettings: unknown) {}
		classify = vi.fn().mockResolvedValue([
			{ tag: 'reference', category: 'Status', confidence: 0.9, rawScore: 1, weightedScore: 1, sources: [] },
		]);
	},
}));

vi.mock('./link-resolver', () => ({
	LinkResolver: class MockLinkResolver {
		constructor(_app: unknown, _analyzer: unknown, _getSettings: unknown) {}
		findInternalLinks = vi.fn().mockReturnValue([
			{ targetPath: 'Notes/Related.md', displayText: 'Related', relevanceScore: 0.8, reason: 'shares tags' },
		]);
		mergeTopicCandidates = vi.fn((_topics: unknown, graphLinks: unknown[]) => graphLinks);
	},
}));

vi.mock('./topic-extractor', () => ({
	TopicExtractor: class MockTopicExtractor {
		constructor(_app: unknown, _analyzer: unknown, _getSettings: unknown) {}
		clearPending = vi.fn();
		extractTopics = vi.fn().mockResolvedValue([]);
		resolveNewNoteCandidates = vi.fn().mockReturnValue(new Map());
	},
}));

vi.mock('./prompt-builder', () => ({
	PromptBuilder: class MockPromptBuilder {
		constructor(_getSettings: unknown) {}
		suggestExternalLinks = vi.fn().mockResolvedValue([]);
		suggestFrontmatter = vi.fn().mockResolvedValue([
			{ key: 'type', value: 'reference', action: 'add' },
		]);
	},
}));

// The applier is the side effect we assert on for auto-accept.
const applySpy = vi
	.fn<(proposal: EnrichmentProposal, accepted: AcceptedItems) => Promise<void>>()
	.mockResolvedValue(undefined);
vi.mock('./enrichment-applier', () => ({
	EnrichmentApplier: class MockEnrichmentApplier {
		constructor(_app: unknown, _getSettings: unknown) {}
		apply = applySpy;
		undo = vi.fn().mockResolvedValue(undefined);
	},
}));

/** In-memory adapter so EnrichmentStore round-trips proposals via JSON. */
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

describe('EnrichmentModule auto-accept (#228)', () => {
	let adapter: ReturnType<typeof createMemoryAdapter>;
	let mockPlugin: { app: Record<string, unknown>; addCommand: ReturnType<typeof vi.fn>; registerEvent: ReturnType<typeof vi.fn> };
	let settings: SynapseSettings;
	let notifications: NotificationManager;
	let sourceFile: TFile;

	beforeEach(() => {
		applySpy.mockClear();
		adapter = createMemoryAdapter();
		settings = structuredClone(DEFAULT_SETTINGS);
		notifications = new NotificationManager();
		sourceFile = new TFile('notes/ml.md');

		mockPlugin = {
			app: {
				vault: {
					read: vi.fn().mockResolvedValue('# ML\n\nA note about machine learning.'),
					modify: vi.fn().mockResolvedValue(undefined),
					createFolder: vi.fn().mockResolvedValue(undefined),
					getAbstractFileByPath: vi.fn((path: string) =>
						path === 'notes/ml.md' ? sourceFile : null
					),
					adapter,
				},
				metadataCache: {
					getFileCache: vi.fn().mockReturnValue(null),
					on: vi.fn(),
				},
			},
			addCommand: vi.fn(),
			registerEvent: vi.fn(),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function build(shouldAutoAccept: () => boolean): EnrichmentModule {
		return new EnrichmentModule(
			mockPlugin as never,
			() => settings,
			notifications,
			createMockCheckpointManager() as never,
			new CommandRegistrar(mockPlugin as never),
			shouldAutoAccept
		);
	}

	it('auto-accepts a freshly generated enrichment proposal, applying all suggested items', async () => {
		settings.autoAccept.enrichment = true;
		const mod = build(() => settings.autoAccept.enrichment);
		await mod.onload();

		await mod.enrich('notes/ml.md', 'manual');

		// The applier ran with the full generated result accepted.
		expect(applySpy).toHaveBeenCalledTimes(1);
		const accepted = applySpy.mock.calls[0][1];
		expect(accepted.tags).toEqual(['reference']);
		expect(accepted.internalLinks).toEqual(['Notes/Related.md']);
		expect(accepted.frontmatter).toEqual(['type']);

		// Nothing left pending; status is fully accepted.
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(0);
	});

	it('leaves the enrichment proposal pending and applies nothing when the flag is off', async () => {
		settings.autoAccept.enrichment = false;
		const mod = build(() => settings.autoAccept.enrichment);
		await mod.onload();

		await mod.enrich('notes/ml.md', 'manual');

		expect(applySpy).not.toHaveBeenCalled();
		const pending = await mod.getPendingProposals();
		expect(pending).toHaveLength(1);
		expect(pending[0].status).toBe('pending');
	});
});
