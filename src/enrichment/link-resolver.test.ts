import { describe, it, expect, vi } from 'vitest';
import { LinkResolver } from './link-resolver';
import { InternalLinkCandidate } from './types';
import { DEFAULT_SETTINGS } from '../settings';

vi.mock('./weight-calculator', () => ({
	computeProximityWeight: () => 0.8,
}));

function makeSettings(overrides?: Partial<typeof DEFAULT_SETTINGS.enrichment>) {
	return () => ({
		...DEFAULT_SETTINGS,
		enrichment: { ...DEFAULT_SETTINGS.enrichment, ...overrides },
	});
}

function makeMockApp(files: Array<{ path: string }> = []) {
	const TFile = class {};
	const fileInstances = files.map(f => {
		const inst = Object.create(TFile.prototype);
		inst.path = f.path;
		return inst;
	});

	return {
		vault: {
			getMarkdownFiles: () => fileInstances,
			getAbstractFileByPath: (path: string) =>
				fileInstances.find((f: any) => f.path === path) ?? null,
		},
		metadataCache: {
			fileToLinktext: (file: any, _source: string) => {
				const basename = file.path.replace(/.*\//, '').replace(/\.md$/, '');
				return basename;
			},
		},
		_TFile: TFile,
	} as any;
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
	} as any;
}

// ── mergeTopicCandidates ──

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

		const result = resolver.mergeTopicCandidates(topics, graph);
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

		const result = resolver.mergeTopicCandidates(topics, graph);
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

		const result = resolver.mergeTopicCandidates(topics, graph);
		expect(result[0].targetPath).toBe('Topic.md');
		expect(result[0].relevanceScore).toBeGreaterThan(result[1].relevanceScore);
	});

	it('handles empty inputs', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		expect(resolver.mergeTopicCandidates([], [])).toEqual([]);
		expect(resolver.mergeTopicCandidates([], [
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.3, reason: 'graph' },
		])).toHaveLength(1);
		expect(resolver.mergeTopicCandidates([
			{ targetPath: 'A.md', displayText: 'A', relevanceScore: 0.7, reason: 'topic' },
		], [])).toHaveLength(1);
	});

	it('sorts results by relevance descending', () => {
		const app = makeMockApp();
		const resolver = new LinkResolver(app, makeMockAnalyzer(), makeSettings());

		const topics: InternalLinkCandidate[] = [
			{ targetPath: 'Low.md', displayText: 'Low', relevanceScore: 0.3, reason: 'topic' },
			{ targetPath: 'High.md', displayText: 'High', relevanceScore: 0.9, reason: 'topic' },
			{ targetPath: 'Mid.md', displayText: 'Mid', relevanceScore: 0.6, reason: 'topic' },
		];

		const result = resolver.mergeTopicCandidates(topics, []);
		expect(result[0].targetPath).toBe('High.md');
		expect(result[1].targetPath).toBe('Mid.md');
		expect(result[2].targetPath).toBe('Low.md');
	});
});
