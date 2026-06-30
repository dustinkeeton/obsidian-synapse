import { describe, it, expect } from 'vitest';
import { createEl, type StubEl } from './__mocks__/obsidian';
import {
	parseChangelog,
	renderChangelog,
	stripInlineMarkdown,
} from './changelog';

const SAMPLE = `# Changelog

All notable changes to Synapse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- A brand new **feature** with \`code\`

## [1.0.6] - 2026-06-22

### Added

- Click an [error notice](https://example.com) to copy its message

### Changed

- Softer, less alarming color
- Clearer, more consistent wording
`;

/** Recursively collect every element in a stub tree. */
function walkEls(el: StubEl, out: StubEl[] = []): StubEl[] {
	for (const child of el.children as unknown as StubEl[]) {
		out.push(child);
		walkEls(child, out);
	}
	return out;
}
const elsWithTag = (root: StubEl, tag: string): StubEl[] =>
	walkEls(root).filter((e) => e.tagName === tag);
const elsWithClass = (root: StubEl, cls: string): StubEl[] =>
	walkEls(root).filter((e) => e.classList.contains(cls));

describe('stripInlineMarkdown', () => {
	it('unwraps bold, code, and links to their visible text', () => {
		expect(stripInlineMarkdown('A **bold** word')).toBe('A bold word');
		expect(stripInlineMarkdown('Use `code` here')).toBe('Use code here');
		expect(stripInlineMarkdown('See [the docs](https://x.com)')).toBe('See the docs');
	});

	it('leaves plain text untouched', () => {
		expect(stripInlineMarkdown('nothing to strip')).toBe('nothing to strip');
	});
});

describe('parseChangelog', () => {
	it('extracts version entries in document order, ignoring the title/preamble', () => {
		const entries = parseChangelog(SAMPLE);
		expect(entries.map((e) => e.version)).toEqual(['Unreleased', '1.0.6']);
	});

	it('parses the release date when present and null for Unreleased', () => {
		const [unreleased, released] = parseChangelog(SAMPLE);
		expect(unreleased.date).toBeNull();
		expect(released.date).toBe('2026-06-22');
	});

	it('groups bullets under their section headings', () => {
		const released = parseChangelog(SAMPLE)[1];
		expect(released.sections.map((s) => s.title)).toEqual(['Added', 'Changed']);
		expect(released.sections[1].items).toEqual([
			'Softer, less alarming color',
			'Clearer, more consistent wording',
		]);
	});

	it('strips inline markdown from bullet text', () => {
		const unreleased = parseChangelog(SAMPLE)[0];
		expect(unreleased.sections[0].items).toEqual(['A brand new feature with code']);
		const released = parseChangelog(SAMPLE)[1];
		expect(released.sections[0].items[0]).toBe(
			'Click an error notice to copy its message',
		);
	});

	it('returns an empty array for markdown with no version headings', () => {
		expect(parseChangelog('# Changelog\n\nJust a preamble.\n')).toEqual([]);
	});
});

describe('renderChangelog', () => {
	it('renders a version heading per entry, including the date', () => {
		const container = createEl();
		renderChangelog(container, SAMPLE);
		const versions = elsWithClass(container, 'synapse-changelog-version').map(
			(e) => e.textContent,
		);
		expect(versions).toContain('Unreleased');
		expect(versions).toContain('1.0.6 — 2026-06-22');
	});

	it('renders section subheadings and bullet list items', () => {
		const container = createEl();
		renderChangelog(container, SAMPLE);
		const sections = elsWithClass(container, 'synapse-changelog-section').map(
			(e) => e.textContent,
		);
		expect(sections).toContain('Added');
		expect(sections).toContain('Changed');

		const items = elsWithTag(container, 'LI').map((e) => e.textContent);
		expect(items).toContain('Softer, less alarming color');
		expect(items).toContain('Click an error notice to copy its message');
	});

	it('marks the entry matching the current version with a modifier class', () => {
		const container = createEl();
		renderChangelog(container, SAMPLE, '1.0.6');
		const highlighted = elsWithClass(container, 'synapse-changelog-entry--current');
		expect(highlighted).toHaveLength(1);
		// The highlighted entry is the 1.0.6 release, not Unreleased.
		const version = elsWithClass(highlighted[0], 'synapse-changelog-version')[0];
		expect(version.textContent).toBe('1.0.6 — 2026-06-22');
	});

	it('does not highlight any entry when the current version is absent', () => {
		const container = createEl();
		renderChangelog(container, SAMPLE, '9.9.9');
		expect(elsWithClass(container, 'synapse-changelog-entry--current')).toHaveLength(0);
	});

	it('shows a fallback message when there are no entries', () => {
		const container = createEl();
		renderChangelog(container, '# Changelog\n\nNothing yet.\n');
		const empty = elsWithClass(container, 'synapse-changelog-empty');
		expect(empty).toHaveLength(1);
		expect(empty[0].textContent).toBe('No changelog entries found.');
	});
});
