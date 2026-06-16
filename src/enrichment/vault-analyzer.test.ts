import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultAnalyzer } from './vault-analyzer';
import { TFile } from '../__mocks__/obsidian';

const noExclusions = () => ({ exclusions: [] }) as any;
const settingsWith = (exclusions: unknown[]) => () => ({ exclusions }) as any;

function createMockApp(files: TFile[], caches: Map<string, any>, resolvedLinks: Record<string, Record<string, number>> = {}) {
	return {
		vault: {
			getMarkdownFiles: vi.fn().mockReturnValue(files),
		},
		metadataCache: {
			getFileCache: vi.fn().mockImplementation((file: TFile) => caches.get(file.path) || null),
			resolvedLinks,
		},
	} as any;
}

describe('VaultAnalyzer', () => {
	describe('buildTagIndex', () => {
		it('builds tag index from vault files', () => {
			const file1 = new TFile('notes/a.md');
			const file2 = new TFile('notes/b.md');

			const caches = new Map();
			caches.set('notes/a.md', {
				tags: [{ tag: '#python' }, { tag: '#ml' }],
			});
			caches.set('notes/b.md', {
				tags: [{ tag: '#python' }, { tag: '#web' }],
			});

			const app = createMockApp([file1, file2], caches);
			const analyzer = new VaultAnalyzer(app, noExclusions);
			const index = analyzer.buildTagIndex();

			expect(index.tags.get('#python')).toEqual({
				count: 2,
				files: ['notes/a.md', 'notes/b.md'],
			});
			expect(index.tags.get('#ml')).toEqual({
				count: 1,
				files: ['notes/a.md'],
			});
			expect(index.tags.get('#web')).toEqual({
				count: 1,
				files: ['notes/b.md'],
			});
		});

		it('omits files in folders excluded for enrichment (#323)', () => {
			const included = new TFile('notes/a.md');
			const excluded = new TFile('Templates/t.md');
			const caches = new Map();
			caches.set('notes/a.md', { tags: [{ tag: '#python' }] });
			caches.set('Templates/t.md', { tags: [{ tag: '#tpl' }] });

			const app = createMockApp([included, excluded], caches);
			const analyzer = new VaultAnalyzer(
				app,
				settingsWith([{ pattern: 'Templates/**', features: ['enrichment'] }])
			);
			const index = analyzer.buildTagIndex();

			expect(index.tags.get('#python')).toEqual({ count: 1, files: ['notes/a.md'] });
			expect(index.tags.has('#tpl')).toBe(false);
		});

		it('returns empty index for vault with no tags', () => {
			const file = new TFile('empty.md');
			const caches = new Map();
			caches.set('empty.md', {});

			const app = createMockApp([file], caches);
			const analyzer = new VaultAnalyzer(app, noExclusions);
			const index = analyzer.buildTagIndex();

			expect(index.tags.size).toBe(0);
		});

		it('caches results and invalidates on call', () => {
			const file = new TFile('note.md');
			const caches = new Map();
			caches.set('note.md', { tags: [{ tag: '#test' }] });

			const app = createMockApp([file], caches);
			const analyzer = new VaultAnalyzer(app, noExclusions);

			const index1 = analyzer.buildTagIndex();
			const index2 = analyzer.buildTagIndex();
			expect(index1).toBe(index2); // Same reference — cached

			analyzer.invalidate();
			const index3 = analyzer.buildTagIndex();
			expect(index3).not.toBe(index1); // New instance after invalidation
		});
	});

	describe('buildLinkGraph', () => {
		it('builds bidirectional link graph', () => {
			const resolvedLinks = {
				'a.md': { 'b.md': 1, 'c.md': 2 },
				'b.md': { 'c.md': 1 },
			};

			const app = createMockApp([], new Map(), resolvedLinks);
			const analyzer = new VaultAnalyzer(app, noExclusions);
			const graph = analyzer.buildLinkGraph();

			// Outgoing
			expect(graph.outgoing.get('a.md')).toEqual(new Set(['b.md', 'c.md']));
			expect(graph.outgoing.get('b.md')).toEqual(new Set(['c.md']));

			// Incoming
			expect(graph.incoming.get('b.md')).toEqual(new Set(['a.md']));
			expect(graph.incoming.get('c.md')).toEqual(new Set(['a.md', 'b.md']));
		});

		it('handles empty resolved links', () => {
			const app = createMockApp([], new Map(), {});
			const analyzer = new VaultAnalyzer(app, noExclusions);
			const graph = analyzer.buildLinkGraph();

			expect(graph.outgoing.size).toBe(0);
			expect(graph.incoming.size).toBe(0);
		});
	});

	describe('getFileTags', () => {
		it('returns normalized tags for a file', () => {
			const file = new TFile('note.md');
			const caches = new Map();
			caches.set('note.md', {
				tags: [{ tag: '#Python' }, { tag: '#ML' }],
			});

			const app = createMockApp([file], caches);
			const analyzer = new VaultAnalyzer(app, noExclusions);

			expect(analyzer.getFileTags(file as any)).toEqual(['#python', '#ml']);
		});

		it('returns empty array for file with no cache', () => {
			const file = new TFile('uncached.md');
			const app = createMockApp([file], new Map());
			const analyzer = new VaultAnalyzer(app, noExclusions);

			expect(analyzer.getFileTags(file as any)).toEqual([]);
		});
	});

	describe('getOutgoingLinks / getIncomingLinks', () => {
		it('returns link neighbors', () => {
			const resolvedLinks = {
				'a.md': { 'b.md': 1 },
				'b.md': { 'a.md': 1, 'c.md': 1 },
			};

			const app = createMockApp([], new Map(), resolvedLinks);
			const analyzer = new VaultAnalyzer(app, noExclusions);

			expect(analyzer.getOutgoingLinks('a.md')).toEqual(['b.md']);
			expect(analyzer.getIncomingLinks('a.md')).toEqual(['b.md']);
			expect(analyzer.getOutgoingLinks('b.md')).toEqual(['a.md', 'c.md']);
		});

		it('returns empty for unknown files', () => {
			const app = createMockApp([], new Map(), {});
			const analyzer = new VaultAnalyzer(app, noExclusions);

			expect(analyzer.getOutgoingLinks('unknown.md')).toEqual([]);
			expect(analyzer.getIncomingLinks('unknown.md')).toEqual([]);
		});
	});
});
