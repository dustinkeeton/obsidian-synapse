import { describe, it, expect } from 'vitest';
import { buildPhotoBlock, buildMermaidItemBlock, attributionLine } from './inserter';
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
