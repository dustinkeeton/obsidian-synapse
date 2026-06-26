import { describe, it, expect, vi } from 'vitest';

// Mock the bundled changelog so the test is decoupled from the real CHANGELOG.md
// (and so Vitest never tries to transform a `.md` file — only esbuild does that
// at build time). The specifier matches changelog-modal.ts's `'../CHANGELOG.md'`.
vi.mock('../CHANGELOG.md', () => ({
	default: `# Changelog

## [Unreleased]

### Added

- Something brand new

## [1.0.6] - 2026-06-22

### Changed

- A polished detail
`,
}));

import { createEl } from './__mocks__/obsidian';
import { ChangelogModal } from './changelog-modal';

/** Recursively collect every element in a stub tree. */
function walkEls(el: any, out: any[] = []): any[] {
	for (const child of el?.children ?? []) {
		out.push(child);
		walkEls(child, out);
	}
	return out;
}
const elsWithClass = (root: any, cls: string): any[] =>
	walkEls(root).filter((e) => e.classList?.contains(cls));
const elsWithTag = (root: any, tag: string): any[] =>
	walkEls(root).filter((e) => e.tagName === tag);

function openModal(version = '1.0.6') {
	const plugin = { manifest: { version } } as never;
	const modal = new ChangelogModal({} as never, plugin);
	// The mock Modal's contentEl is a bare stub; swap in an introspectable one.
	(modal as unknown as { contentEl: HTMLElement }).contentEl = createEl();
	modal.onOpen();
	return modal;
}

describe('ChangelogModal', () => {
	it('renders a title heading', () => {
		const modal = openModal();
		const contentEl = (modal as unknown as { contentEl: any }).contentEl;
		const headings = elsWithTag(contentEl, 'H2').map((e) => e.textContent);
		expect(headings).toContain("What's new in Synapse");
	});

	it('renders the parsed changelog entries (version headings + items)', () => {
		const modal = openModal();
		const contentEl = (modal as unknown as { contentEl: any }).contentEl;

		const versions = elsWithClass(contentEl, 'synapse-changelog-version').map(
			(e) => e.textContent,
		);
		expect(versions).toContain('Unreleased');
		expect(versions).toContain('1.0.6 — 2026-06-22');

		const items = elsWithTag(contentEl, 'LI').map((e) => e.textContent);
		expect(items).toContain('Something brand new');
		expect(items).toContain('A polished detail');
	});

	it('highlights the entry matching the installed version', () => {
		const modal = openModal('1.0.6');
		const contentEl = (modal as unknown as { contentEl: any }).contentEl;
		const highlighted = elsWithClass(contentEl, 'synapse-changelog-entry--current');
		expect(highlighted).toHaveLength(1);
		const version = elsWithClass(highlighted[0], 'synapse-changelog-version')[0];
		expect(version.textContent).toBe('1.0.6 — 2026-06-22');
	});

	it('adds the synapse-changelog hook class to the content element', () => {
		const modal = openModal();
		const contentEl = (modal as unknown as { contentEl: any }).contentEl;
		expect(contentEl.classList.contains('synapse-changelog')).toBe(true);
	});
});
