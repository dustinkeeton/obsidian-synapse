import { describe, it, expect } from 'vitest';
import { mergeRegeneratedNote } from './regenerate';
import { ENRICHMENT_END, ENRICHMENT_START } from '../shared';

const NAV = '> [!note|synapse-nav] Navigation\n> Up: [[Root]]\n> Next: [[Gradient Descent]]';
const ENRICHMENT = `${ENRICHMENT_START}\n## Related Notes\n- [[Loss]]\n${ENRICHMENT_END}`;

describe('mergeRegeneratedNote', () => {
	it('keeps the note frontmatter, nav block and enrichment section around the new body', () => {
		const existing = `---\nparent: "[[Root]]"\ntags: [ml]\n---\n${NAV}\n\nOld body, cut off mid-sent\n\n${ENRICHMENT}\n`;
		const generated = '---\ntags: [other]\nparent: "[[Elsewhere]]"\n---\n\n## Overview\n\nComplete new body.';

		expect(mergeRegeneratedNote(existing, generated)).toBe(
			`---\nparent: "[[Root]]"\ntags: [ml]\n---\n${NAV}\n\n## Overview\n\nComplete new body.\n\n${ENRICHMENT}\n`
		);
	});

	it('writes just the new body when the note has no frontmatter, nav or enrichment', () => {
		expect(mergeRegeneratedNote('Old body', 'New body\n')).toBe('New body\n');
	});

	it('keeps a legacy bare-spelling nav block', () => {
		const legacy = '> [!synapse-nav] Navigation\n> Up: [[Root]]';
		expect(mergeRegeneratedNote(`${legacy}\n\nOld`, 'New')).toBe(`${legacy}\n\nNew\n`);
	});

	it('keeps every enrichment section in order', () => {
		const second = `${ENRICHMENT_START}\n## References\n- https://example.com\n${ENRICHMENT_END}`;
		const merged = mergeRegeneratedNote(`Old\n\n${ENRICHMENT}\n\n${second}\n`, 'New');
		expect(merged).toBe(`New\n\n${ENRICHMENT}\n\n${second}\n`);
	});
});
