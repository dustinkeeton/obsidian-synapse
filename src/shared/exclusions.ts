import type { MetadataCache, TFile } from 'obsidian';
import { normalizePath } from 'obsidian';
import { normalizeFrontmatterTags } from './frontmatter-utils';

/**
 * Every user-facing Synapse flow that can touch a note, as a closed union. This
 * is the vocabulary an {@link ExclusionRule} uses to scope which features a path
 * is hidden from.
 *
 * Deliberately a FRESH 12-member union — NOT reused from `commands/types.ts`'s
 * `FeatureKey` (which is the "modules that own palette commands" set and omits
 * audio/image/intake/title). Exclusion participation is a different axis: it
 * covers every flow that reads/writes a target note, including the post-op and
 * event-driven ones that have no command.
 */
export type FeatureId =
	| 'elaboration'
	| 'enrichment'
	| 'summarize'
	| 'tidy'
	| 'organize'
	| 'deep-dive'
	| 'audio'
	| 'video'
	| 'title'
	| 'image'
	| 'rem'
	| 'intake';

/**
 * Compile-time exhaustiveness guard. Every {@link FeatureId} must appear as a
 * key here; adding a member to the union without listing it is a type error,
 * which forces a future flow to make an explicit decision about whether it
 * participates in path exclusion. Exported so a test (or a future module) can
 * iterate the canonical feature set.
 */
export const ALL_FEATURE_IDS: Record<FeatureId, true> = {
	elaboration: true,
	enrichment: true,
	summarize: true,
	tidy: true,
	organize: true,
	'deep-dive': true,
	audio: true,
	video: true,
	title: true,
	image: true,
	rem: true,
	intake: true,
};

/**
 * A single exclusion rule. `pattern` is a vault-relative glob (see
 * {@link findMatchingRule} for the supported forms); `features` is either the
 * literal `'all'` (block every flow) or an explicit list of {@link FeatureId}s
 * to block (an empty list blocks nothing).
 */
export interface ExclusionRule {
	pattern: string;
	features: 'all' | FeatureId[];
}

/**
 * The slice of {@link SynapseSettings} the matcher reads. Narrowed to just
 * `exclusions` so the matcher stays decoupled from the full settings shape (and
 * so tests can pass a thin object).
 */
interface ExclusionSettings {
	exclusions: ExclusionRule[];
}

/**
 * Escape every regex metacharacter in a literal path segment so it matches
 * literally. Critically this escapes `.` so a pattern like `.synapse/**` cannot
 * over-match `Xsynapse/...`.
 */
function escapeRegex(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a glob `pattern` into an anchored, case-sensitive {@link RegExp}, or
 * return `null` for a pattern that should match nothing (empty after
 * normalization). Supported forms (normalized first via {@link normalizePath},
 * trimmed, with one trailing slash stripped):
 *
 * - `dir/**` → folder and all descendants, NOT the folder itself.
 * - `dir/*`  → direct children only.
 * - `dir/file.md` (has `/`, no wildcard) → that exact path only.
 * - `templates` (bare token, no `/`, no wildcard) → recursive prefix: the token
 *   itself and every descendant (parity with the legacy
 *   `startsWith(folder + '/')` behavior, and lets a hand-typed folder name "just
 *   work").
 *
 * Mid-segment wildcards (e.g. `dir/*.md`) are intentionally out of scope for v1
 * and fall through to the exact-path branch.
 */
function patternToRegExp(pattern: string): RegExp | null {
	// Normalize separators, trim surrounding whitespace, and drop exactly one
	// trailing slash (so `dir/` behaves like `dir`). Never let an empty pattern
	// compile — that would match everything.
	let normalized = normalizePath(pattern.trim()).trim();
	if (normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}
	if (normalized === '' || normalized === '/') {
		return null;
	}

	if (normalized.endsWith('/**')) {
		const base = normalized.slice(0, -3);
		if (base === '') return null;
		return new RegExp(`^${escapeRegex(base)}/.*$`);
	}

	if (normalized.endsWith('/*')) {
		const base = normalized.slice(0, -2);
		if (base === '') return null;
		return new RegExp(`^${escapeRegex(base)}/[^/]+$`);
	}

	if (!normalized.includes('/')) {
		// Bare token → recursive prefix (the token itself or any descendant).
		return new RegExp(`^${escapeRegex(normalized)}(/.*)?$`);
	}

	// Has a slash, no recognized wildcard → exact file path.
	return new RegExp(`^${escapeRegex(normalized)}$`);
}

/**
 * Whether a rule applies to the given feature. `'all'` applies to every
 * feature; an explicit list applies only when it includes `feature` (so `[]`
 * applies to nothing).
 */
function ruleAppliesToFeature(rule: ExclusionRule, feature: FeatureId): boolean {
	return rule.features === 'all' || rule.features.includes(feature);
}

/**
 * The exclusion primitive. Iterate `settings.exclusions` in array order and
 * return the FIRST rule that (a) applies to `feature` and (b) whose pattern
 * matches `path`, or `null` if none do. First-match-wins is deterministic, so a
 * Notice can name a stable rule.
 *
 * @param path vault-relative path of the note being considered
 * @param feature the flow asking whether it may touch `path`
 * @param settings settings carrying the `exclusions` list
 */
export function findMatchingRule(
	path: string,
	feature: FeatureId,
	settings: ExclusionSettings,
): ExclusionRule | null {
	for (const rule of settings.exclusions) {
		if (!ruleAppliesToFeature(rule, feature)) continue;
		const regex = patternToRegExp(rule.pattern);
		if (regex && regex.test(path)) return rule;
	}
	return null;
}

/**
 * Convenience boolean wrapper over {@link findMatchingRule}: `true` when some
 * rule excludes `path` for `feature`.
 */
export function isPathExcluded(
	path: string,
	feature: FeatureId,
	settings: ExclusionSettings,
): boolean {
	return findMatchingRule(path, feature, settings) !== null;
}

/**
 * Shared tag-exclusion check, extracted from the six modules that each
 * hand-rolled it. Reads the note's frontmatter `tags` from the metadata cache
 * and returns `true` when any configured `excludeTags` entry matches one of
 * them, comparing with a leading `#` stripped from BOTH sides (so `no-enrich`,
 * `#no-enrich`, and a frontmatter `#no-enrich` all compare equal). Path
 * exclusion is centralized in {@link isPathExcluded}; tag exclusion stays
 * per-module (each passes its own `excludeTags`).
 */
export function matchesExcludeTag(
	file: TFile,
	excludeTags: string[],
	metadataCache: MetadataCache,
): boolean {
	if (excludeTags.length === 0) return false;
	const cache = metadataCache.getFileCache(file);
	const raw = cache?.frontmatter?.tags;
	if (raw === undefined || raw === null) return false;

	const fileTags = normalizeFrontmatterTags(raw).map(stripHash);
	const wanted = excludeTags.map(stripHash);
	return wanted.some((tag) => fileTags.includes(tag));
}

/** Strip a single leading `#` so tag comparisons are hash-insensitive. */
function stripHash(tag: string): string {
	return tag.startsWith('#') ? tag.slice(1) : tag;
}
