import { describe, it, expect, vi } from 'vitest';
import { stripUnresolvedLinks, wikilinkTargets, linkResolves } from './link-guard';

function resolver(existing: string[]) {
	const known = new Set(existing.map((e) => e.toLowerCase()));
	return { getFirstLinkpathDest: vi.fn((linkpath: string) => (known.has(linkpath.toLowerCase()) ? { path: `${linkpath}.md` } : null)) };
}

describe('stripUnresolvedLinks', () => {
	it('keeps a link whose note exists', () => {
		expect(stripUnresolvedLinks('See [[Alpha]].', resolver(['Alpha']), 'n.md')).toBe('See [[Alpha]].');
	});

	it('turns an unresolved link into its target text', () => {
		expect(stripUnresolvedLinks('See [[Ghost]].', resolver([]), 'n.md')).toBe('See Ghost.');
	});

	it('turns an unresolved aliased link into its alias', () => {
		expect(stripUnresolvedLinks('See [[Ghost|the ghost]].', resolver([]), 'n.md')).toBe('See the ghost.');
	});

	it('keeps a resolved aliased link', () => {
		expect(stripUnresolvedLinks('[[Alpha|a]]', resolver(['Alpha']), 'n.md')).toBe('[[Alpha|a]]');
	});

	it('resolves heading and block refs by their note part', () => {
		const r = resolver(['Alpha']);
		expect(stripUnresolvedLinks('[[Alpha#Intro]] [[Alpha^abc]] [[Alpha#^abc]]', r, 'n.md'))
			.toBe('[[Alpha#Intro]] [[Alpha^abc]] [[Alpha#^abc]]');
		expect(r.getFirstLinkpathDest).toHaveBeenCalledWith('Alpha', 'n.md');
		expect(stripUnresolvedLinks('[[Ghost#Intro]]', r, 'n.md')).toBe('Ghost#Intro');
	});

	it('leaves same-note heading refs alone', () => {
		const r = resolver([]);
		expect(stripUnresolvedLinks('[[#Intro]] [[#^abc|here]]', r, 'n.md')).toBe('[[#Intro]] [[#^abc|here]]');
		expect(r.getFirstLinkpathDest).not.toHaveBeenCalled();
	});

	it('leaves embeds untouched even when unresolved', () => {
		expect(stripUnresolvedLinks('![[photo.png]] ![[Ghost]]', resolver([]), 'n.md')).toBe('![[photo.png]] ![[Ghost]]');
	});

	it('leaves links inside fenced code and inline code untouched', () => {
		const text = ['```', '[[Ghost]]', '```', '`[[Ghost]]` and [[Ghost]]', '> ~~~', '> [[Ghost]]', '> ~~~'].join('\n');
		expect(stripUnresolvedLinks(text, resolver([]), 'n.md'))
			.toBe(['```', '[[Ghost]]', '```', '`[[Ghost]]` and Ghost', '> ~~~', '> [[Ghost]]', '> ~~~'].join('\n'));
	});

	it('handles the table-escaped alias pipe', () => {
		expect(stripUnresolvedLinks('| [[Ghost\\|g]] |', resolver([]), 'n.md')).toBe('| g |');
		expect(stripUnresolvedLinks('| [[Alpha\\|a]] |', resolver(['Alpha']), 'n.md')).toBe('| [[Alpha\\|a]] |');
	});

	it('keeps unresolved links listed in keep (case-insensitive)', () => {
		expect(stripUnresolvedLinks('[[Future]] [[Ghost]]', resolver([]), 'n.md', { keep: ['future'] }))
			.toBe('[[Future]] Ghost');
	});

	it('strips links inside frontmatter values', () => {
		expect(stripUnresolvedLinks('---\nparent: "[[Ghost]]"\n---\nBody', resolver([]), 'n.md'))
			.toBe('---\nparent: "Ghost"\n---\nBody');
	});

	it('returns text without links unchanged', () => {
		const r = resolver([]);
		expect(stripUnresolvedLinks('plain [text](x.md)', r, 'n.md')).toBe('plain [text](x.md)');
		expect(r.getFirstLinkpathDest).not.toHaveBeenCalled();
	});
});

describe('wikilinkTargets', () => {
	it('collects lowercased note parts of non-embed links outside code', () => {
		expect([...wikilinkTargets('[[Alpha#H]] [[Beta|b]] ![[img.png]] `[[Code]]` [[#Self]]')]).toEqual(['alpha', 'beta']);
	});
});

describe('linkResolves', () => {
	it('passes the source path through to the resolver', () => {
		const r = resolver(['Alpha']);
		expect(linkResolves('Alpha', r, 'dir/n.md')).toBe(true);
		expect(r.getFirstLinkpathDest).toHaveBeenCalledWith('Alpha', 'dir/n.md');
		expect(linkResolves('Ghost', r, 'dir/n.md')).toBe(false);
	});
});
