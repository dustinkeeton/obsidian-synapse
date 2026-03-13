import { parseYaml, stringifyYaml } from 'obsidian';

export interface ParsedNote {
	frontmatter: Record<string, unknown>;
	body: string;
	hasFrontmatter: boolean;
}

/**
 * Parse a markdown note into frontmatter object and body text.
 * Returns empty frontmatter if none exists.
 */
export function parseFrontmatter(content: string): ParsedNote {
	const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
	const match = content.match(fmRegex);

	if (!match) {
		return { frontmatter: {}, body: content, hasFrontmatter: false };
	}

	let frontmatter: Record<string, unknown>;
	try {
		frontmatter = (parseYaml(match[1]) as Record<string, unknown>) || {};
	} catch {
		frontmatter = {};
	}

	const body = content.slice(match[0].length);
	return { frontmatter, body, hasFrontmatter: true };
}

/**
 * Serialize frontmatter and body back into a markdown string.
 * Omits frontmatter block if the object is empty.
 */
export function serializeFrontmatter(
	frontmatter: Record<string, unknown>,
	body: string
): string {
	const keys = Object.keys(frontmatter);
	if (keys.length === 0) return body;

	const yaml = stringifyYaml(frontmatter).trimEnd();
	return `---\n${yaml}\n---\n${body}`;
}

/**
 * Merge tags into a frontmatter object without duplicates.
 * Handles both string and array formats for the `tags` field.
 */
export function mergeTags(
	frontmatter: Record<string, unknown>,
	newTags: string[]
): void {
	const existing = normalizeTags(frontmatter.tags);
	const merged = [...existing];
	for (const tag of newTags) {
		const clean = tag.startsWith('#') ? tag.slice(1) : tag;
		if (!merged.includes(clean)) {
			merged.push(clean);
		}
	}
	frontmatter.tags = merged;
}

/** Normalize the `tags` field to a string array. */
function normalizeTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(String);
	}
	if (typeof value === 'string') {
		return value.split(',').map(s => s.trim()).filter(Boolean);
	}
	return [];
}
