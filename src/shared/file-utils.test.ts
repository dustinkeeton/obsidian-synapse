import { describe, it, expect } from 'vitest';
import { getIncludedMarkdownFiles, findAvailableVaultPath } from './file-utils';
import { TFile } from '../__mocks__/obsidian';
import { createMockApp } from '../__test-utils__/mock-factories';
import type { App } from 'obsidian';
import type { ExclusionRule } from './exclusions';

function settingsWith(exclusions: ExclusionRule[]) {
	return { exclusions };
}

function appWith(files: TFile[]): App {
	const app = createMockApp();
	app.vault.getMarkdownFiles.mockReturnValue(files);
	return app as unknown as App;
}

describe('getIncludedMarkdownFiles', () => {
	it('returns all files when no exclusion rules apply', () => {
		const a = new TFile('notes/a.md');
		const b = new TFile('notes/b.md');
		const result = getIncludedMarkdownFiles(appWith([a, b]), 'enrichment', settingsWith([]));
		expect(result).toEqual([a, b]);
	});

	it('drops a folder and all its descendants for the asked feature (`dir/**`)', () => {
		const kept = new TFile('notes/a.md');
		const child = new TFile('Archive/b.md');
		const deep = new TFile('Archive/sub/c.md');
		const result = getIncludedMarkdownFiles(
			appWith([kept, child, deep]),
			'enrichment',
			settingsWith([{ pattern: 'Archive/**', features: ['enrichment'] }])
		);
		expect(result).toEqual([kept]);
	});

	it('does not drop files when the rule is scoped to a different feature', () => {
		const file = new TFile('Personal/note.md');
		const result = getIncludedMarkdownFiles(
			appWith([file]),
			'enrichment',
			settingsWith([{ pattern: 'Personal/**', features: ['organize'] }])
		);
		expect(result).toEqual([file]);
	});

	it('applies `features: "all"` rules to every feature', () => {
		const file = new TFile('.synapse/state.md');
		const result = getIncludedMarkdownFiles(
			appWith([file]),
			'rem',
			settingsWith([{ pattern: '.synapse/**', features: 'all' }])
		);
		expect(result).toEqual([]);
	});

	it('still scopes to a folder prefix when one is given', () => {
		const inFolder = new TFile('Notes/a.md');
		const outOfFolder = new TFile('Other/b.md');
		const result = getIncludedMarkdownFiles(
			appWith([inFolder, outOfFolder]),
			'enrichment',
			settingsWith([]),
			'Notes'
		);
		expect(result).toEqual([inFolder]);
	});
});

/** App stub whose vault reports a fixed set of taken paths. */
function appWithPaths(taken: string[]): App {
	const set = new Set(taken);
	const app = createMockApp();
	app.vault.getAbstractFileByPath.mockImplementation((path: string) =>
		set.has(path) ? new TFile(path) : null
	);
	return app as unknown as App;
}

describe('findAvailableVaultPath', () => {
	it('returns the desired path unchanged when it is free', () => {
		const app = appWithPaths([]);
		expect(findAvailableVaultPath(app, 'Notes/Idea.md')).toBe('Notes/Idea.md');
	});

	it('appends -1 before the extension on a single collision', () => {
		const app = appWithPaths(['Notes/Idea.md']);
		expect(findAvailableVaultPath(app, 'Notes/Idea.md')).toBe('Notes/Idea-1.md');
	});

	it('skips to -2 when both the base and -1 are taken', () => {
		const app = appWithPaths(['Notes/Idea.md', 'Notes/Idea-1.md']);
		expect(findAvailableVaultPath(app, 'Notes/Idea.md')).toBe('Notes/Idea-2.md');
	});

	it('suffixes the whole name when the path has no extension', () => {
		const app = appWithPaths(['Notes/Idea']);
		expect(findAvailableVaultPath(app, 'Notes/Idea')).toBe('Notes/Idea-1');
	});

	it('treats a dot in a folder name (not the basename) as part of the path, not an extension', () => {
		// `my.notes/file` has no real extension: the last dot is in the folder.
		const app = appWithPaths(['my.notes/file']);
		expect(findAvailableVaultPath(app, 'my.notes/file')).toBe('my.notes/file-1');
	});

	it('suffixes before the extension even when the folder also contains a dot', () => {
		const app = appWithPaths(['my.notes/file.md']);
		expect(findAvailableVaultPath(app, 'my.notes/file.md')).toBe('my.notes/file-1.md');
	});
});
