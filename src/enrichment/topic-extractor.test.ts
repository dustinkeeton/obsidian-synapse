import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopicExtractor } from './topic-extractor';
import { SynapseSettings, DEFAULT_SETTINGS } from '../settings';

const mockComplete = vi.fn();

vi.mock('../shared', () => ({
	AIClient: class MockAIClient {
		complete = mockComplete;
	},
	sanitizeAIResponse: (text: string) => text,
}));

vi.mock('./weight-calculator', () => ({
	computeProximityWeight: () => 0.8,
}));

function makeSettings(overrides?: Partial<SynapseSettings['enrichment']>): () => SynapseSettings {
	return () => ({
		...DEFAULT_SETTINGS,
		enrichment: {
			...DEFAULT_SETTINGS.enrichment,
			...overrides,
		},
	});
}

function makeMockApp(files: Array<{ basename: string; path: string }> = []) {
	return {
		vault: {
			getMarkdownFiles: () =>
				files.map(f => ({ basename: f.basename, path: f.path })),
			getAbstractFileByPath: (path: string) => {
				const found = files.find(f => f.path === path);
				return found ? { ...found, constructor: { name: 'TFile' } } : null;
			},
		},
		metadataCache: {
			fileToLinktext: (_file: unknown, _source: string) => {
				const f = _file as { basename: string };
				return f.basename;
			},
		},
	} as unknown as import('obsidian').App;
}

function makeMockAnalyzer() {
	return {} as unknown as import('./vault-analyzer').VaultAnalyzer;
}

describe('TopicExtractor', () => {
	beforeEach(() => {
		mockComplete.mockReset();
	});

	it('matches topics to existing vault notes (case-insensitive)', async () => {
		const app = makeMockApp([
			{ basename: 'Machine Learning', path: 'Notes/Machine Learning.md' },
			{ basename: 'Python', path: 'Notes/Python.md' },
		]);
		mockComplete.mockResolvedValue('["Machine Learning", "Python", "Unknown Topic"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		const results = await extractor.extractTopics('Some ML content', 'Notes/my-note.md', []);

		// Only matched topics appear as immediate candidates
		expect(results).toHaveLength(2);
		expect(results[0].targetPath).toBe('Notes/Machine Learning.md');
		expect(results[1].targetPath).toBe('Notes/Python.md');
	});

	it('filters out topics already linked', async () => {
		const app = makeMockApp([
			{ basename: 'Machine Learning', path: 'Notes/Machine Learning.md' },
		]);
		mockComplete.mockResolvedValue('["Machine Learning"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		const results = await extractor.extractTopics(
			'Content', 'Notes/my-note.md', ['Notes/Machine Learning.md']
		);

		expect(results).toHaveLength(0);
	});

	it('respects suggestNewNotes=false — unmatched topics are not accumulated', async () => {
		const app = makeMockApp([]);
		mockComplete.mockResolvedValue('["Brand New Topic"]');

		const extractor = new TopicExtractor(
			app, makeMockAnalyzer(), makeSettings({ suggestNewNotes: false })
		);
		// Call from two notes — but suggestNewNotes is off
		await extractor.extractTopics('Content A', 'note-a.md', []);
		await extractor.extractTopics('Content B', 'note-b.md', []);

		const newNotes = extractor.resolveNewNoteCandidates();
		expect(newNotes.size).toBe(0);
	});

	it('deduplicates case-insensitive topics', async () => {
		const app = makeMockApp([
			{ basename: 'React', path: 'Notes/React.md' },
		]);
		mockComplete.mockResolvedValue('["React", "react", "REACT"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		const results = await extractor.extractTopics('Content', 'note.md', []);

		expect(results).toHaveLength(1);
	});

	it('respects maxTopicLinks setting', async () => {
		const app = makeMockApp([
			{ basename: 'Topic 1', path: 'Topic 1.md' },
			{ basename: 'Topic 2', path: 'Topic 2.md' },
			{ basename: 'Topic 3', path: 'Topic 3.md' },
			{ basename: 'Topic 4', path: 'Topic 4.md' },
			{ basename: 'Topic 5', path: 'Topic 5.md' },
		]);
		mockComplete.mockResolvedValue(
			'["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"]'
		);

		const extractor = new TopicExtractor(
			app, makeMockAnalyzer(), makeSettings({ maxTopicLinks: 2 })
		);
		const results = await extractor.extractTopics('Content', 'note.md', []);

		expect(results).toHaveLength(2);
	});

	it('handles AI error gracefully', async () => {
		const app = makeMockApp([]);
		mockComplete.mockRejectedValue(new Error('API error'));

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		const results = await extractor.extractTopics('Content', 'note.md', []);

		expect(results).toHaveLength(0);
	});

	it('handles AI returning invalid JSON gracefully', async () => {
		const app = makeMockApp([]);
		mockComplete.mockResolvedValue('not json');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		const results = await extractor.extractTopics('Content', 'note.md', []);

		expect(results).toHaveLength(0);
	});

	// ── New-note candidate resolution (cross-note evidence) ──

	it('unmatched topics from a single note do NOT become new-note candidates', async () => {
		const app = makeMockApp([]);
		mockComplete.mockResolvedValue('["Brand New Concept"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		const results = await extractor.extractTopics('Content', 'note.md', []);

		// No immediate candidates for unmatched topics
		expect(results).toHaveLength(0);

		// Only 1 note references it — not enough for a new-note suggestion
		const newNotes = extractor.resolveNewNoteCandidates();
		expect(newNotes.size).toBe(0);
	});

	it('unmatched topics referenced by 2+ notes become new-note candidates', async () => {
		const app = makeMockApp([]);
		mockComplete.mockResolvedValue('["Shared Concept"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());

		// Two different notes both surface the same unmatched topic
		await extractor.extractTopics('Content about shared concept', 'note-a.md', []);
		await extractor.extractTopics('More about shared concept', 'note-b.md', []);

		const newNotes = extractor.resolveNewNoteCandidates();

		// Both notes should get the candidate
		expect(newNotes.size).toBe(2);
		expect(newNotes.has('note-a.md')).toBe(true);
		expect(newNotes.has('note-b.md')).toBe(true);

		const candidatesA = newNotes.get('note-a.md')!;
		expect(candidatesA).toHaveLength(1);
		expect(candidatesA[0].targetPath).toBe('Shared Concept.md');
		expect(candidatesA[0].relevanceScore).toBe(0.5);
		expect(candidatesA[0].reason).toContain('2 notes');
	});

	it('resolveNewNoteCandidates clears pending state', async () => {
		const app = makeMockApp([]);
		mockComplete.mockResolvedValue('["Topic X"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		await extractor.extractTopics('A', 'note-a.md', []);
		await extractor.extractTopics('B', 'note-b.md', []);

		// First resolve returns candidates
		const first = extractor.resolveNewNoteCandidates();
		expect(first.size).toBe(2);

		// Second resolve is empty — buffer was cleared
		const second = extractor.resolveNewNoteCandidates();
		expect(second.size).toBe(0);
	});

	it('clearPending discards accumulated topics', async () => {
		const app = makeMockApp([]);
		mockComplete.mockResolvedValue('["Transient Topic"]');

		const extractor = new TopicExtractor(app, makeMockAnalyzer(), makeSettings());
		await extractor.extractTopics('A', 'note-a.md', []);
		await extractor.extractTopics('B', 'note-b.md', []);

		extractor.clearPending();

		const newNotes = extractor.resolveNewNoteCandidates();
		expect(newNotes.size).toBe(0);
	});
});
