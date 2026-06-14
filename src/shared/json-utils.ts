import type { DataAdapter } from 'obsidian';

/**
 * Shared JSON helpers for safely reading and narrowing untrusted data.
 *
 * The on-disk JSON stores (proposals, snapshots, runs) historically did
 * `const x: T = JSON.parse(content)`, which lies to the type system: parsed
 * JSON is `any`, so a corrupt or hand-edited file silently flows through as a
 * fully-typed `T`. These helpers force callers to narrow with a type guard
 * before the value is treated as `T`.
 */

/**
 * Parse a JSON string, returning `unknown` so callers are forced to narrow.
 *
 * Unlike `JSON.parse` (whose return type is `any`), this returns `unknown`.
 * Error behavior intentionally matches `JSON.parse`: this **throws**
 * `SyntaxError` on malformed input. It is a thin, honest wrapper — swallowing
 * parse errors here would hide failures from callers that do want them. The
 * "never throw on bad data" contract that the stores rely on lives in
 * {@link readJsonFile}, which catches parse failures and returns `null`.
 */
export function parseJson(text: string): unknown {
	return JSON.parse(text) as unknown;
}

/**
 * Type guard: narrows `unknown` to a non-null, non-array object.
 *
 * This is the building block for structural guards — once narrowed, fields can
 * be probed via `v.someField` with `v` typed as `Record<string, unknown>`.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Coerce an unknown value to a `string[]`.
 *
 * - An array is mapped element-wise via `String(...)` (numbers/objects become
 *   their string form), matching how Obsidian surfaces frontmatter list values.
 * - Anything else (string, undefined, null, object) yields `[]`.
 *
 * For frontmatter `tags`/`aliases` specifically, prefer
 * `normalizeFrontmatterTags`, which also handles the comma-separated single
 * string form.
 */
export function asStringArray(v: unknown): string[] {
	if (Array.isArray(v)) {
		return v.map(item => String(item));
	}
	return [];
}

/**
 * Read a JSON file, parse it, and validate it against a type guard.
 *
 * Reads via the vault {@link DataAdapter} (the same API the stores use:
 * `app.vault.adapter`). Returns `T` only when the file exists, parses as JSON,
 * and satisfies `guard`. Returns `null` on **any** failure — missing file,
 * read error, malformed JSON, or guard rejection — so the stores keep their
 * existing "invalid/missing → skip" contract without scattering try/catch.
 *
 * @param adapter Vault data adapter (`app.vault.adapter`).
 * @param path Normalized vault-relative path to the JSON file.
 * @param guard Structural type guard that confirms the parsed value is a `T`.
 */
export async function readJsonFile<T>(
	adapter: DataAdapter,
	path: string,
	guard: (v: unknown) => v is T
): Promise<T | null> {
	try {
		const content = await adapter.read(path);
		const parsed = parseJson(content);
		return guard(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
