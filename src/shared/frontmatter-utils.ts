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
	const existing = normalizeFrontmatterTags(frontmatter.tags);
	const merged = [...existing];
	for (const tag of newTags) {
		const clean = tag.startsWith('#') ? tag.slice(1) : tag;
		if (!merged.includes(clean)) {
			merged.push(clean);
		}
	}
	frontmatter.tags = merged;
}

/**
 * Normalize a frontmatter list value (e.g. `tags` or `aliases`) to a string
 * array.
 *
 * Real-vault frontmatter values are untyped: a list field may be an array of
 * strings/numbers/objects, a single comma-separated string, or absent. This
 * coerces all of those to `string[]`, replacing the copy-pasted
 * `Array.isArray(x) ? x : [x]` ternaries scattered across the feature modules.
 *
 * - Array: each element is stringified via `String(...)`.
 * - String: split on commas and trimmed (so `"a, b"` → `['a', 'b']`).
 * - Anything else (undefined/null/object): `[]`.
 */
export function normalizeFrontmatterTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map(String);
	}
	if (typeof value === 'string') {
		return value.split(',').map(s => s.trim()).filter(Boolean);
	}
	return [];
}
