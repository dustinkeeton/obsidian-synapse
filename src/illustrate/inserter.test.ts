import { describe, it, expect } from 'vitest';
import { findAnchorLine, insertAtAnchor, buildPhotoBlock, buildMermaidItemBlock, attributionLine } from './inserter';
import type { IllustrateItem, MediaCandidate } from './types';

const candidate: MediaCandidate = {
	provider: 'wikimedia',
	title: 'Red panda.jpg',
	fileUrl: 'https://upload.wikimedia.org/red-panda.jpg',
	thumbnailUrl: 'https://upload.wikimedia.org/thumb/red-panda.jpg',
	pageUrl: 'https://commons.wikimedia.org/wiki/File:Red_panda.jpg',
	license: 'CC BY-SA',
	licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
	attribution: 'Jane Doe',
};

const photoItem: Extract<IllustrateItem, { kind: 'photo' }> = {
	id: 'p1', kind: 'photo', anchor: '## Habitat', caption: 'A red [panda]', rationale: '', candidate,
};

const NOTE = ['---', 'tags: [a]', '---', '# Red panda', '', '## Habitat', 'They live in forests.', 'High in the trees.', '', '## Diet', 'Bamboo.'].join('\n');

describe('findAnchorLine', () => {
	const lines = NOTE.split('\n');

	it('matches a heading regardless of hashes and case', () => {
		expect(findAnchorLine(lines, 'habitat')).toBe(5);
	});

	it('matches a paragraph by its opening words and ignores wikilink syntax', () => {
		expect(findAnchorLine(lines, 'They live in')).toBe(6);
		expect(findAnchorLine(['Eats [[Bamboo|bamboo]] daily'], 'Eats bamboo daily')).toBe(0);
	});

	it('returns -1 for an unknown or empty anchor', () => {
		expect(findAnchorLine(lines, 'Nowhere')).toBe(-1);
		expect(findAnchorLine(lines, '   ')).toBe(-1);
	});
});

describe('insertAtAnchor', () => {
	it('inserts directly after a heading and keeps frontmatter intact', () => {
		const out = insertAtAnchor(NOTE, '## Habitat', 'BLOCK');
		expect(out.startsWith('---\ntags:')).toBe(true);
		expect(out).toContain('## Habitat\n\nBLOCK\n\nThey live in forests.');
	});

	it('inserts after the end of an anchored paragraph', () => {
		const out = insertAtAnchor(NOTE, 'They live in forests', 'BLOCK');
		expect(out).toContain('High in the trees.\n\nBLOCK\n\n## Diet');
	});

	it('appends at the end when the anchor is not found', () => {
		const out = insertAtAnchor(NOTE, 'missing', 'BLOCK');
		expect(out.trimEnd().endsWith('Bamboo.\n\nBLOCK')).toBe(true);
	});
});

describe('block builders', () => {
	it('builds a vault embed plus an attribution callout', () => {
		const block = buildPhotoBlock(photoItem, 'attachments/red-panda.jpg');
		expect(block).toContain('![[attachments/red-panda.jpg]]');
		expect(block).toContain('> [!synapse-illustrate] A red [panda]');
		expect(block).toContain('[CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0)');
		expect(block).toContain('Jane Doe');
	});

	it('falls back to a remote URL embed when no vault path is given', () => {
		expect(buildPhotoBlock(photoItem, null)).toContain('![A red panda](https://upload.wikimedia.org/red-panda.jpg)');
	});

	it('omits a link when the license URL is empty', () => {
		expect(attributionLine({ ...candidate, licenseUrl: '' })).toContain('License: CC BY-SA ·');
	});

	it('builds a mermaid fence with a caption callout', () => {
		const block = buildMermaidItemBlock({ id: 'd', kind: 'chart', anchor: 'x', caption: 'Counts', rationale: '', mermaid: 'xychart-beta' });
		expect(block.startsWith('```mermaid\nxychart-beta\n```')).toBe(true);
		expect(block).toContain('> [!synapse-illustrate] Counts\n> Chart built from figures in this note');
	});
});
