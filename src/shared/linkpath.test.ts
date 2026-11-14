import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { linkpathFor } from './linkpath';

function appWith(paths: string[]): App {
	const files = paths.map((path) => ({ path, basename: path.replace(/^.*\//, '').replace(/\.md$/, '') }));
	return { vault: { getMarkdownFiles: () => files } } as unknown as App;
}

describe('linkpathFor', () => {
	it('returns the bare basename for a unique note', () => {
		expect(linkpathFor(appWith(['a/b/Topic.md', 'a/Other.md']), 'a/b/Topic.md')).toBe('Topic');
	});

	it('qualifies a note whose basename another note shares, case-insensitively', () => {
		const app = appWith(['Projects/Alpha/Untitled.md', 'Projects/Beta/untitled.md']);
		expect(linkpathFor(app, 'Projects/Alpha/Untitled.md')).toBe('Projects/Alpha/Untitled');
	});

	it('qualifies a target that does not exist yet when another note has its basename', () => {
		expect(linkpathFor(appWith(['Other/Topic.md']), 'New/Topic.md')).toBe('New/Topic');
	});

	it('keeps a vault-root note bare, since its path is its basename', () => {
		expect(linkpathFor(appWith(['Topic.md', 'a/Topic.md']), 'Topic.md')).toBe('Topic');
	});

	it.each(['C# Notes', 'Ref^1', 'A|B', 'x[1]'])('returns null for an ambiguous note under %s', (folder) => {
		const app = appWith([`${folder}/Topic.md`, 'Other/Topic.md']);
		expect(linkpathFor(app, `${folder}/Topic.md`)).toBeNull();
	});

	it('keeps a unique note bare even under a folder with link syntax', () => {
		expect(linkpathFor(appWith(['C# Notes/Delegates.md']), 'C# Notes/Delegates.md')).toBe('Delegates');
	});
});
