import { ENRICHMENT_END, ENRICHMENT_START, splitRawFrontmatter } from '../shared';
import { findNavigationBlock } from './syllabus-navigator';

const ENRICHMENT_BLOCK_RE = new RegExp(`${escapeRegExp(ENRICHMENT_START)}[\\s\\S]*?${escapeRegExp(ENRICHMENT_END)}`, 'g');

/**
 * Replace an accepted deep-dive note's body with a regenerated one. The note's own
 * frontmatter, its `synapse-nav` block and every enrichment section are kept verbatim;
 * the generated text's frontmatter is dropped.
 */
export function mergeRegeneratedNote(existing: string, generated: string): string {
	const { raw, body } = splitRawFrontmatter(existing);
	const frontmatter = raw && !raw.endsWith('\n') ? raw + '\n' : raw;
	const nav = findNavigationBlock(body);
	const enrichment = body.match(ENRICHMENT_BLOCK_RE) ?? [];
	const newBody = splitRawFrontmatter(generated).body.trim();
	const parts = [nav, newBody, ...enrichment].filter((part): part is string => !!part);
	return frontmatter + parts.join('\n\n') + '\n';
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
