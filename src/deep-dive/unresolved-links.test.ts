import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepDiveModule } from './index';
import { CommandRegistrar } from '../commands';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { NotificationManager, NoteOperationQueue, wikilinkTargets } from '../shared';
import { createMockCheckpointManager, makeModuleDeps } from '../__test-utils__/mock-factories';
import { TFile } from '../__mocks__/obsidian';
import type { DeepDiveProposal, DeepDiveRun } from './types';

vi.mock('./topic-analyzer', () => ({
	TopicAnalyzer: class MockTopicAnalyzer {
		extractTopics = vi.fn().mockResolvedValue([]);
	},
}));
vi.mock('./note-generator', () => ({
	NoteGenerator: class MockNoteGenerator {
		generateContent = vi.fn().mockResolvedValue('');
	},
}));

const ROOT = 'notes/Root.md';

function createVault() {
	const files = new Map<string, string>();
	const adapterFiles = new Map<string, string>();
	const basename = (p: string) => p.replace(/\.md$/, '').split('/').pop()!.toLowerCase();
	files.set(ROOT, '# Root');
	return {
		files,
		adapterFiles,
		vault: {
			getAbstractFileByPath: vi.fn((p: string) => (files.has(p) ? new TFile(p) : null)),
			read: vi.fn(async (f: TFile) => files.get(f.path) ?? ''),
			create: vi.fn(async (p: string, c: string) => { files.set(p, c); return new TFile(p); }),
			process: vi.fn(async (f: TFile, fn: (d: string) => string) => { files.set(f.path, fn(files.get(f.path) ?? '')); }),
			createFolder: vi.fn().mockResolvedValue(undefined),
			adapter: {
				read: vi.fn(async (p: string) => { if (!adapterFiles.has(p)) throw new Error('ENOENT'); return adapterFiles.get(p)!; }),
				write: vi.fn(async (p: string, c: string) => { adapterFiles.set(p, c); }),
				exists: vi.fn(async (p: string) => [...adapterFiles.keys()].some((k) => k === p || k.startsWith(p + '/'))),
				remove: vi.fn(async (p: string) => { adapterFiles.delete(p); }),
				list: vi.fn(async (folder: string) => ({ files: [...adapterFiles.keys()].filter((k) => k.startsWith(folder + '/')), folders: [] })),
			},
		},
		metadataCache: {
			getFileCache: vi.fn().mockReturnValue(null),
			getFirstLinkpathDest: vi.fn((lp: string) =>
				[...files.keys()].some((p) => basename(p) === lp.toLowerCase()) ? {} : null),
		},
	};
}

function proposal(id: string, title: string, content: string, status: DeepDiveProposal['status'] = 'pending'): DeepDiveProposal {
	return {
		id,
		runId: 'run-1',
		sourceNotePath: ROOT,
		topic: { title, description: '', relevance: 1, existsInVault: false, relatedUrls: [] },
		proposedPath: `Deep Dives/Root/${title}.md`,
		proposedContent: content,
		depth: 0,
		qualityScore: { score: 0.9 } as never,
		childProposalIds: [],
		createdAt: new Date().toISOString(),
		status,
	};
}

describe('deep dive accept writes no unresolved links (#581)', () => {
	let env: ReturnType<typeof createVault>;
	let settings: SynapseSettings;

	beforeEach(() => {
		env = createVault();
		settings = structuredClone(DEFAULT_SETTINGS);
	});

	async function build(proposals: DeepDiveProposal[]): Promise<DeepDiveModule> {
		const plugin = { app: { vault: env.vault, metadataCache: env.metadataCache }, addCommand: vi.fn(), registerEvent: vi.fn() };
		const mod = new DeepDiveModule(makeModuleDeps({
			plugin: plugin as never,
			getSettings: () => settings,
			notifications: new NotificationManager(),
			checkpointManager: createMockCheckpointManager() as never,
			registrar: new CommandRegistrar(plugin),
			noteQueue: new NoteOperationQueue(),
		}));
		await mod.onload();
		const folder = settings.deepDive.proposalFolderPath;
		const run: DeepDiveRun = {
			id: 'run-1', rootNotePath: ROOT, maxDepth: 1, qualityThreshold: 0.4,
			proposalIds: proposals.map((p) => p.id),
			stats: { totalProposals: proposals.length, byDepth: {}, earlyTerminations: 0 },
			createdAt: new Date().toISOString(), status: 'completed',
		};
		env.adapterFiles.set(`${folder}/runs/run-1.json`, JSON.stringify(run));
		for (const p of proposals) {
			env.adapterFiles.set(`${folder}/proposals/${p.id}.json`, JSON.stringify(p));
		}
		return mod;
	}

	function unresolvedIn(text: string): string[] {
		return [...wikilinkTargets(text)].filter((lp) => !env.metadataCache.getFirstLinkpathDest(lp));
	}

	it('keeps the parent link and unlinks a leaf concept beyond the chosen depth', async () => {
		const leaf = proposal('p1', 'Leaf', '---\nparent: "[[Root]]"\n---\n\nSee [[Deeper Concept|deeper]] and [[Root]].');
		const mod = await build([leaf]);

		await mod.acceptProposal('p1');

		const written = env.files.get(leaf.proposedPath)!;
		expect(written).toContain('parent: "[[Root]]"');
		expect(written).toContain('See deeper and [[Root]].');
		expect(unresolvedIn(written)).toEqual([]);
	});

	it('leaves no links to rejected proposals in accepted notes or the syllabus', async () => {
		const kept = proposal('p1', 'Kept', 'Compare with [[Dropped]].');
		const dropped = proposal('p2', 'Dropped', 'Compare with [[Kept]].', 'rejected');
		const mod = await build([kept, dropped]);

		await mod.acceptProposal('p1');

		expect(env.files.has(dropped.proposedPath)).toBe(false);
		for (const [path, content] of env.files) {
			expect(unresolvedIn(content), path).toEqual([]);
		}
		const syllabus = [...env.files.entries()].find(([p]) => p.includes('Deep Dive -- Root'))![1];
		expect(syllabus).toContain('[[Kept]]');
		expect(syllabus).not.toContain('Dropped');
	});
});
