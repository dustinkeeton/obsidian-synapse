import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaceholderDetector } from './detector';
import { DEFAULT_SETTINGS, SynapseSettings } from '../settings';
import { createMockApp, mockFile, type MockApp } from '../__test-utils__/mock-factories';
import type { App } from 'obsidian';
import type { TFile } from '../__mocks__/obsidian';
import type { DetectionResult } from './types';

const NOTE_PATH = 'notes/stub.md';

function words(n: number): string {
	return Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
}

function reasonTypes(result: DetectionResult | null): string[] {
	return result?.reasons.map((r) => r.type) ?? [];
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		Object.freeze(value);
		for (const key of Object.keys(value)) {
			deepFreeze((value as Record<string, unknown>)[key]);
		}
	}
	return value;
}

describe('PlaceholderDetector.detect', () => {
	let app: MockApp;
	let settings: SynapseSettings;
	let detector: PlaceholderDetector;
	let file: TFile;

	function detect(): Promise<DetectionResult | null> {
		return detector.detect(file as never);
	}

	function setContent(content: string): void {
		app.vault.read.mockResolvedValue(content);
	}

	// Registers `linker` as a note whose [[stub]] link resolves to `file`.
	function addInboundLink(linkerPath: string): void {
		const linker = mockFile(linkerPath);
		app.vault.getMarkdownFiles.mockReturnValue([file, linker]);
		app.metadataCache.getFileCache.mockImplementation((f: TFile) =>
			f.path === linkerPath ? { links: [{ link: 'stub' }] } : null
		);
		app.metadataCache.getFirstLinkpathDest.mockImplementation((link: string) =>
			link === 'stub' ? file : null
		);
	}

	beforeEach(() => {
		app = createMockApp();
		settings = structuredClone(DEFAULT_SETTINGS);
		detector = new PlaceholderDetector(app as unknown as App, () => settings);
		file = mockFile(NOTE_PATH);
	});

	describe('exclusions', () => {
		it('returns null for a path matched by an elaboration exclusion rule', async () => {
			settings.exclusions.push({ pattern: 'notes/**', features: ['elaboration'] });
			setContent('TODO');
			expect(await detect()).toBeNull();
		});

		it('ignores exclusion rules scoped to other features', async () => {
			settings.exclusions.push({ pattern: 'notes/**', features: ['summarize'] });
			setContent('TODO');
			expect(await detect()).not.toBeNull();
		});

		it('returns null when frontmatter tags include an excluded tag', async () => {
			app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { tags: ['no-elaborate'] } });
			setContent('TODO');
			expect(await detect()).toBeNull();
		});

		it('returns null when an inline body tag matches an excluded tag', async () => {
			app.metadataCache.getFileCache.mockReturnValue({ tags: [{ tag: '#no-elaborate' }] });
			setContent('TODO');
			expect(await detect()).toBeNull();
		});

		it('detects normally when the note carries only unrelated tags', async () => {
			app.metadataCache.getFileCache.mockReturnValue({ frontmatter: { tags: ['project'] } });
			setContent('TODO');
			expect(await detect()).not.toBeNull();
		});
	});

	describe('short-note', () => {
		it('fires below minWordThreshold with the counted word total', async () => {
			settings.elaboration.detection.minWordThreshold = 10;
			setContent(words(9));
			const result = await detect();
			expect(result).toEqual({ notePath: NOTE_PATH, reasons: [{ type: 'short-note', wordCount: 9 }] });
		});

		it('does not fire at exactly minWordThreshold', async () => {
			settings.elaboration.detection.minWordThreshold = 10;
			setContent(words(10));
			expect(await detect()).toBeNull();
		});

		it('does not fire above minWordThreshold', async () => {
			settings.elaboration.detection.minWordThreshold = 10;
			setContent(words(11));
			expect(await detect()).toBeNull();
		});

		it('strips frontmatter before counting words', async () => {
			settings.elaboration.detection.minWordThreshold = 10;
			setContent(`---\n${words(40)}\n---\n${words(3)}`);
			const result = await detect();
			expect(result?.reasons).toContainEqual({ type: 'short-note', wordCount: 3 });
		});

		it('does not treat a body-only note as having frontmatter', async () => {
			settings.elaboration.detection.minWordThreshold = 10;
			setContent(`${words(5)}\n---\n${words(5)}`);
			expect(await detect()).toBeNull();
		});
	});

	describe('todo-marker', () => {
		const long = words(60);

		it.each(['TODO', 'TBD', 'FIXME', 'PLACEHOLDER'])('fires for %s', async (marker) => {
			setContent(`${long}\n${marker}: fill this in`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'todo-marker', markers: [marker] }]);
		});

		it('matches PLACEHOLDER case-insensitively but TODO/TBD/FIXME case-sensitively', async () => {
			setContent(`${long}\nplaceholder todo tbd fixme`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'todo-marker', markers: ['placeholder'] }]);
		});

		it('requires word boundaries around markers', async () => {
			setContent(`${long}\nTODOS METHOD_TBD FIXMEnow`);
			expect(await detect()).toBeNull();
		});

		it('reports each distinct marker once, in pattern order', async () => {
			setContent(`${long}\nFIXME TODO\nTODO TBD FIXME`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'todo-marker', markers: ['TODO', 'TBD', 'FIXME'] }]);
		});

		it('ignores markers inside frontmatter', async () => {
			setContent(`---\nstatus: TODO\n---\n${long}`);
			expect(await detect()).toBeNull();
		});

		it('does not fire when detectTodoMarkers is off', async () => {
			settings.elaboration.detection.detectTodoMarkers = false;
			setContent(`${long}\nTODO`);
			expect(await detect()).toBeNull();
		});
	});

	describe('empty-section', () => {
		const long = words(60);

		it('fires for a trailing heading with no body', async () => {
			setContent(`# Intro\n${long}\n\n## Details\n\n`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'empty-section', heading: 'Details' }]);
		});

		it('fires for a heading followed directly by a same-level heading', async () => {
			setContent(`## Empty\n## Filled\n${long}`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'empty-section', heading: 'Empty' }]);
		});

		it('fires for a heading followed directly by a higher-level heading', async () => {
			setContent(`# Top\n${long}\n### Deep\n# Next\ntext`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'empty-section', heading: 'Deep' }]);
		});

		it('treats a heading whose only body is a filled subsection as non-empty', async () => {
			setContent(`# Parent\n## Child\n${long}`);
			expect(await detect()).toBeNull();
		});

		it('reports only the first empty heading', async () => {
			setContent(`${long}\n## First\n## Second\n`);
			const result = await detect();
			expect(result?.reasons).toEqual([{ type: 'empty-section', heading: 'First' }]);
		});

		it('does not fire when detectEmptySections is off', async () => {
			settings.elaboration.detection.detectEmptySections = false;
			setContent(`${long}\n## Empty\n`);
			expect(await detect()).toBeNull();
		});
	});

	describe('sparse-link', () => {
		it('fires when an inbound link exists and the note is short', async () => {
			addInboundLink('notes/hub.md');
			setContent(words(5));
			const result = await detect();
			expect(result?.reasons).toContainEqual({ type: 'sparse-link', linkedFrom: ['notes/hub.md'] });
		});

		it('does not fire for a short note with no inbound links', async () => {
			app.vault.getMarkdownFiles.mockReturnValue([file, mockFile('notes/other.md')]);
			app.metadataCache.getFileCache.mockReturnValue({ links: [{ link: 'elsewhere' }] });
			setContent(words(5));
			expect(reasonTypes(await detect())).toEqual(['short-note']);
		});

		it('does not fire for a long note with inbound links', async () => {
			addInboundLink('notes/hub.md');
			setContent(words(60));
			expect(await detect()).toBeNull();
		});

		it('ignores inbound links from paths excluded for elaboration', async () => {
			settings.exclusions.push({ pattern: 'archive/**', features: ['elaboration'] });
			addInboundLink('archive/hub.md');
			setContent(words(5));
			expect(reasonTypes(await detect())).toEqual(['short-note']);
		});

		it('does not fire when detectSparseLinks is off', async () => {
			settings.elaboration.detection.detectSparseLinks = false;
			addInboundLink('notes/hub.md');
			setContent(words(5));
			expect(reasonTypes(await detect())).toEqual(['short-note']);
		});
	});

	describe('result assembly', () => {
		it('accumulates every triggered heuristic in one result', async () => {
			addInboundLink('notes/hub.md');
			setContent('TODO\n\n## Empty\n');
			const result = await detect();
			expect(result).toEqual({
				notePath: NOTE_PATH,
				reasons: [
					{ type: 'todo-marker', markers: ['TODO'] },
					{ type: 'empty-section', heading: 'Empty' },
					{ type: 'short-note', wordCount: 3 },
					{ type: 'sparse-link', linkedFrom: ['notes/hub.md'] },
				],
			});
		});

		it('returns null when no heuristic fires', async () => {
			setContent(`# Complete\n${words(60)}`);
			expect(await detect()).toBeNull();
		});

		it('does not mutate the settings object', async () => {
			deepFreeze(settings);
			addInboundLink('notes/hub.md');
			setContent('TODO\n\n## Empty\n');
			await expect(detect()).resolves.not.toBeNull();
		});
	});
});
