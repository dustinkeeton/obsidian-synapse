import { describe, it, expect, vi } from 'vitest';
import { LinkResolver } from './link-resolver';
import { InternalLinkCandidate } from './types';
import { DEFAULT_SETTINGS } from '../settings';
import { mockFile as rawFile } from '../__test-utils__/mock-factories';
import type { App, TFile } from 'obsidian';
import type { VaultAnalyzer } from './vault-analyzer';

// The mock TFile (from __test-utils__) and obsidian's real TFile differ
// structurally; tests only need the runtime instance, so cross the boundary
// once here with a typed cast.
const mockFile = (path: string): TFile => rawFile(path) as unknown as TFile;

vi.mock('./weight-calculator', () => ({
	computeProximityWeight: () => 0.8,
}));

function makeSettings(overrides?: Partial<typeof DEFAULT_SETTINGS.enrichment>) {
	return () => ({
		...DEFAULT_SETTINGS,
		enrichment: { ...DEFAULT_SETTINGS.enrichment, ...overrides },
	});
}

function makeMockApp(
	files: Array<{ path: string }> = [],
	resolve: (linkpath: string, source: string) => { path: string } | null = () => null,
	frontmatter: Record<string, unknown> | null = null
) {
	const LocalTFile = class {};
	const fileInstances = files.map((f) => {
		const inst = Object.create(LocalTFile.prototype) as { path: string };
		inst.path = f.path;
		return inst;
	});

	return {
		vault: {
			getMarkdownFiles: () => fileInstances,
			getAbstractFileByPath: (path: string) =>
				fileInstances.find((f) => f.path === path) ?? null,
		},
		metadataCache: {
			fileToLinktext: (file: { path: string }, _source: string) => {
				const basename = file.path.replace(/.*\//, '').replace(/\.md$/, '');
				return basename;
			},
			getFirstLinkpathDest: resolve,
			getFileCache: () => (frontmatter ? { frontmatter } : null),
		},
		_TFile: LocalTFile,
	} as unknown as App;
}

function makeMockAnalyzer(opts: {
	tags?: string[];
	tagIndex?: Map<string, { count: number; files: string[] }>;
	outgoing?: Map<string, string[]>;
	incoming?: Map<string, string[]>;
} = {}) {
	return {
		getFileTags: () => opts.tags ?? [],
		buildTagIndex: () => ({
			tags: opts.tagIndex ?? new Map(),
		}),
		getOutgoingLinks: (path: string) => opts.outgoing?.get(path) ?? [],
		getIncomingLinks: (path: string) => opts.incoming?.get(path) ?? [],
	} as unknown as VaultAnalyzer;
}

// ── mergeTopicCandidates ──

const SOURCE = 'sound/Music Arrangement.md';

describe('LinkResolver.mergeTopicCandidates', () => {
	it('returns topic-only candidates when no graph overlap', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		const topics: InternalLinkCandidate[] = [
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.8, reason: 'AI topic' },
		];
		const graph: InternalLinkCandidate[] = [
			{ targetPath: 'B.md', displayText: 'B', relevanceScore: 0.2, reason: '2-hop' },
		];

		const result = resolver.mergeTopicCandidates(topics, graph, SOURCE);
		expect(result).toHaveLength(2);
		expect(result[0].targetPath).toBe('A.md');
		expect(result[0].relevanceScore).toBe(0.8);
		expect(result[1].targetPath).toBe('B.md');
	});

	it('boosts score when topic and graph overlap on same file', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		const topics: InternalLinkCandidate[] = [
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.7, reason: 'AI topic' },
		];
		const graph: InternalLinkCandidate[] = [
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.3, reason: '2-hop' },
		];

		const result = resolver.mergeTopicCandidates(topics, graph, SOURCE);
		expect(result).toHaveLength(1);
		// topic score + graph * 0.2 = 0.7 + 0.3*0.2 = 0.76
		expect(result[0].relevanceScore).toBeCloseTo(0.76);
		expect(result[0].reason).toContain('AI topic');
		expect(result[0].reason).toContain('2-hop');
	});

	it('topic candidates dominate over graph-only candidates', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		const topics: InternalLinkCandidate[] = [
			{ targetPath: 'Topic.md', displayText: 'Topic', relevanceScore: 0.7, reason: 'AI topic' },
		];
		const graph: InternalLinkCandidate[] = [
			{ targetPath: 'Nearby.md', displayText: 'Nearby', relevanceScore: 0.25, reason: 'folder' },
		];

		const result = resolver.mergeTopicCandidates(topics, graph, SOURCE);
		expect(result[0].targetPath).toBe('Topic.md');
		expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
	});

	it('handles empty inputs', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		expect(resolver.mergeTopicCandidates([], [], SOURCE)).toEqual([]);
		expect(resolver.mergeTopicCandidates([], [
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.3, reason: 'graph' },
		], SOURCE)).toHaveLength(1);
		expect(resolver.mergeTopicCandidates([
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.7, reason: 'topic' },
		], [], SOURCE)).toHaveLength(1);
	});

	it('sorts results by relevance descending', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		const topics: InternalLinkCandidate[] = [
			{ targetPath: 'Low.md', displayText: 'Low', relevanceScore: 0.3, reason: 'topic' },
			{ targetPath: 'High.md', displayText: 'High', relevanceScore: 0.9, reason: 'topic' },
			{ targetPath: 'Mid.md', displayText: 'Mid', relevanceScore: 0.6, reason: 'topic' },
		];

		const result = resolver.mergeTopicCandidates(topics, [], SOURCE);
		expect(result[0].targetPath).toBe('High.md');
		expect(result[1].targetPath).toBe('Mid.md');
		expect(result[2].targetPath).toBe('Low.md');
	});

	it('drops a topic whose target path is the source note', () => {
		const resolver = new LinkResolver(makeMockApp(), makeMockAnalyzer(), makeSettings());
		const result = resolver.mergeTopicCandidates([
			{ targetPath: SOURCE, displayText: 'Music Arrangement', relevanceScore: 0.9, reason: 'AI-identified topic' },
			{ targetPath: 'sound/Harmony.md', displayText: 'Harmony', relevanceScore: 0.8, reason: 'AI-identified topic' },
		], [], SOURCE);
		expect(result.map((r) => r.targetPath)).toEqual(['sound/Harmony.md']);
	});

	it('drops a topic that resolves to the source note by basename', () => {
		const app = makeMockApp([], (lp) => (lp.toLowerCase() === 'music arrangement' ? { path: SOURCE } : null));
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());
		const result = resolver.mergeTopicCandidates([
			{ targetPath: 'Music arrangement.md', displayText: 'Music arrangement', relevanceScore: 0.5, reason: 'AI-identified topic (2 notes reference this)' },
		], [
			{ targetPath: 'sound/Mixing.md', displayText: 'Mixing', relevanceScore: 0.3, reason: 'nearby folder' },
		], SOURCE);
		expect(result.map((r) => r.targetPath)).toEqual(['sound/Mixing.md']);
	});

	it('drops a basename match even when the cache cannot resolve it', () => {
		const resolver = new LinkResolver(makeMockApp(), makeMockAnalyzer(), makeSettings());
		const result = resolver.mergeTopicCandidates([
			{ targetPath: 'Music Arrangement.md', displayText: 'Music Arrangement', relevanceScore: 0.5, reason: 'AI-identified topic' },
		], [], SOURCE);
		expect(result).toEqual([]);
	});

	it('drops a topic matching one of the source note aliases', () => {
		const app = {
			vault: { getAbstractFileByPath: (p: string) => (p === SOURCE ? mockFile(SOURCE) : null) },
			metadataCache: {
				getFirstLinkpathDest: () => null,
				getFileCache: () => ({ frontmatter: { aliases: ['Arranging'] } }),
			},
		} as unknown as App;
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());
		const result = resolver.mergeTopicCandidates([
			{ targetPath: 'Arranging.md', displayText: 'arranging', relevanceScore: 0.5, reason: 'AI-identified topic' },
		], [], SOURCE);
		expect(result).toEqual([]);
	});

	it('keeps a topic whose linkpath resolves to another note even when it equals a source alias', () => {
		const app = {
			vault: { getAbstractFileByPath: (p: string) => (p === SOURCE ? mockFile(SOURCE) : null) },
			metadataCache: {
				getFirstLinkpathDest: (lp: string) => (lp === 'Arranging' ? { path: 'sound/Arranging.md' } : null),
				getFileCache: () => ({ frontmatter: { aliases: ['Arranging'] } }),
			},
		} as unknown as App;
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());
		const result = resolver.mergeTopicCandidates([
			{ targetPath: 'sound/Arranging.md', displayText: 'Arranging', relevanceScore: 0.5, reason: 'AI-identified topic' },
		], [], SOURCE);
		expect(result.map((r) => r.targetPath)).toEqual(['sound/Arranging.md']);
	});
});

// ── findInternalLinks ──
// These use the centralized obsidian-mock TFile so the resolver's
// `targetFile instanceof TFile` guard passes (the makeMockApp above uses a
// local TFile class, which is fine for mergeTopicCandidates but not here).

/** App whose getAbstractFileByPath resolves every path to a real mock TFile. */
function makeTFileApp(markdownPaths: string[] = []) {
	return {
		vault: {
			getMarkdownFiles: () => markdownPaths.map((p) => mockFile(p)),
			getAbstractFileByPath: (path: string) => mockFile(path),
		},
		metadataCache: {
			fileToLinktext: (file: TFile) => file.basename,
		},
	} as unknown as App;
}

describe('LinkResolver.findInternalLinks', () => {
	function settingsWith(overrides?: Partial<typeof DEFAULT_SETTINGS.enrichment>) {
		return makeSettings({ internalLinkThreshold: 0, ...overrides });
	}

	it('surfaces files that share two or more tags', () => {
		const app = makeTFileApp();
		const analyzer = makeMockAnalyzer({
			tags: ['#x', '#y'],
			tagIndex: new Map([
				['#x', { count: 1, files: ['folder/B.md'] }],
				['#y', { count: 1, files: ['folder/B.md'] }],
			]),
		});
		const resolver = new LinkResolver(app, analyzer, settingsWith());

		const result = resolver.findInternalLinks(mockFile('folder/A.md'), []);
		const b = result.find((r) => r.targetPath === 'folder/B.md');
		expect(b).toBeDefined();
		expect(b!.reason).toContain('shares 2 tags');
		expect(b!.displayText).toBe('B');
	});

	it('ignores files sharing only a single tag', () => {
		const app = makeTFileApp();
		const analyzer = makeMockAnalyzer({
			tags: ['#x', '#y'],
			tagIndex: new Map([
				['#x', { count: 1, files: ['folder/B.md'] }],
				['#y', { count: 1, files: ['folder/C.md'] }],
			]),
		});
		const resolver = new LinkResolver(app, analyzer, settingsWith());

		expect(resolver.findInternalLinks(mockFile('folder/A.md'), [])).toEqual([]);
	});

	it('surfaces same-folder files as proximity candidates', () => {
		const app = makeTFileApp(['folder/A.md', 'folder/B.md']);
		const resolver = new LinkResolver(app, makeMockAnalyzer(), settingsWith());

		const result = resolver.findInternalLinks(mockFile('folder/A.md'), []);
		const b = result.find((r) => r.targetPath === 'folder/B.md');
		expect(b).toBeDefined();
		expect(b!.reason).toContain('nearby folder');
	});

	it('surfaces 2-hop link-graph neighbors', () => {
		const app = makeTFileApp();
		const analyzer = makeMockAnalyzer({
			outgoing: new Map([
				['A.md', ['B.md']],
				['B.md', ['C.md']],
			]),
		});
		const resolver = new LinkResolver(app, analyzer, settingsWith());

		const result = resolver.findInternalLinks(mockFile('A.md'), []);
		const c = result.find((r) => r.targetPath === 'C.md');
		expect(c).toBeDefined();
		expect(c!.reason).toContain('2-hop link neighbor');
	});

	it('excludes already-linked paths', () => {
		const app = makeTFileApp(['folder/A.md', 'folder/B.md']);
		const resolver = new LinkResolver(app, makeMockAnalyzer(), settingsWith());

		const result = resolver.findInternalLinks(mockFile('folder/A.md'), ['folder/B.md']);
		expect(result).toEqual([]);
	});

	it('filters out candidates that fall below the threshold', () => {
		const app = makeTFileApp(['folder/A.md', 'folder/B.md']);
		const resolver = new LinkResolver(
			app,
			makeMockAnalyzer(),
			settingsWith({ internalLinkThreshold: 0.9 })
		);

		expect(resolver.findInternalLinks(mockFile('folder/A.md'), [])).toEqual([]);
	});

	it('caps results at maxInternalLinks, highest score first', () => {
		const app = makeTFileApp();
		const analyzer = makeMockAnalyzer({
			tags: ['#x', '#y', '#z'],
			tagIndex: new Map([
				['#x', { count: 2, files: ['folder/B.md', 'folder/C.md'] }],
				['#y', { count: 2, files: ['folder/B.md', 'folder/C.md'] }],
				['#z', { count: 1, files: ['folder/B.md'] }],
			]),
		});
		const resolver = new LinkResolver(
			app,
			analyzer,
			settingsWith({ maxInternalLinks: 1 })
		);

		const result = resolver.findInternalLinks(mockFile('folder/A.md'), []);
		expect(result).toHaveLength(1);
		// B shares 3 tags, C shares 2 → B ranks first
		expect(result[0].targetPath).toBe('folder/B.md');
	});
});
