import { describe, it, expect, vi } from 'vitest';
import { getIncludedMarkdownFiles } from './file-utils';
import { TFile } from '../__mocks__/obsidian';
import type { ExclusionRule } from './exclusions';

function settingsWith(exclusions: ExclusionRule[]) {
	return { exclusions };
}

function appWith(files: TFile[]) {
	return {
		vault: {
			getMarkdownFiles: vi.fn().mockReturnValue(files),
		},
	} as any;
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
