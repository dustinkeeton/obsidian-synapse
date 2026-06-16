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
export interface ExclusionSettings {
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
	// Defensive: tolerate a missing/undefined list (partial settings) as "no
	// rules" rather than throwing. Real settings always carry it via defaults.
	const rules = settings?.exclusions;
	if (!Array.isArray(rules)) return null;
	for (const rule of rules) {
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
	if (!cache) return false;

	// Collect tags from BOTH sources, matching the most inclusive legacy behavior
	// (enrichment read Obsidian's getAllTags): frontmatter `tags` (array or
	// comma/space-separated string, coerced by normalizeFrontmatterTags) AND inline
	// body `#tags` (cache.tags). Compare with a leading `#` stripped and case
	// folded — Obsidian treats tags case-insensitively.
	const frontmatterTags = normalizeFrontmatterTags(cache.frontmatter?.tags);
	const inlineTags = cache.tags?.map((t) => t.tag) ?? [];
	const fileTags = [...frontmatterTags, ...inlineTags].map(foldTag);
	const wanted = excludeTags.map(foldTag);
	return wanted.some((tag) => fileTags.includes(tag));
}

/**
 * Normalize a tag for comparison: strip a single leading `#` and case-fold, so
 * `no-enrich`, `#no-enrich`, and `#No-Enrich` all compare equal.
 */
function foldTag(tag: string): string {
	const stripped = tag.startsWith('#') ? tag.slice(1) : tag;
	return stripped.toLowerCase();
}

/**
 * Read-only shape of the legacy persisted settings the #307 migration inspects.
 * Only the per-module `excludeFolders` lists matter; everything else is ignored.
 * Deliberately a narrow read type (not `any`) so the migration stays type-safe.
 * Every field is optional — older/partial data may omit any of these.
 */
export interface LegacyModuleExclusions {
	elaboration?: { detection?: { excludeFolders?: unknown } };
	enrichment?: { excludeFolders?: unknown };
	summarize?: { excludeFolders?: unknown };
	organize?: { excludeFolders?: unknown };
	deepDive?: { excludeFolders?: unknown };
}

/**
 * The features that carried a legacy per-module `excludeFolders` list. `rem`
 * mirrored `enrichment`'s list at runtime, so it joins the set. When a single
 * folder appeared in EVERY one of these, the migrated rule collapses to
 * `features: 'all'` (this is how the shared `templates`/`.synapse` folders
 * broaden to all flows on upgrade); otherwise it stays scoped to exactly the
 * features that listed it.
 */
const LEGACY_FOLDER_FEATURES: FeatureId[] = [
	'elaboration',
	'enrichment',
	'summarize',
	'organize',
	'deep-dive',
	'rem',
];

/** Coerce an unknown legacy `excludeFolders` value to a clean `string[]`. */
function readLegacyFolders(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Canonicalize a legacy folder name into the stored `<folder>/**` form (strip a
 * trailing slash first). The legacy matcher was `startsWith(folder + '/')` — a
 * recursive descendant match — which `<folder>/**` reproduces exactly.
 */
function canonicalizeLegacyFolder(folder: string): string {
	const trimmed = folder.trim().replace(/\/+$/, '');
	return `${trimmed}/**`;
}

/**
 * Build the migrated {@link ExclusionRule}[] from legacy per-module
 * `excludeFolders` data (#307). For each module's folders (with `rem` mirroring
 * `enrichment`), record which features listed each folder; canonicalize the
 * folder to `<name>/**`; then emit one rule per distinct pattern —
 * `features: 'all'` when the pattern was listed by ALL
 * {@link LEGACY_FOLDER_FEATURES}, otherwise the specific sorted feature list.
 * Pattern order is first-seen across the module scan, which is deterministic.
 */
export function buildMigratedExclusions(data: LegacyModuleExclusions): ExclusionRule[] {
	// Preserve first-seen pattern order with a Map; track the feature set per
	// canonical pattern.
	const byPattern = new Map<string, Set<FeatureId>>();

	const record = (folders: string[], feature: FeatureId): void => {
		for (const folder of folders) {
			const pattern = canonicalizeLegacyFolder(folder);
			let set = byPattern.get(pattern);
			if (!set) {
				set = new Set<FeatureId>();
				byPattern.set(pattern, set);
			}
			set.add(feature);
		}
	};

	const enrichmentFolders = readLegacyFolders(data.enrichment?.excludeFolders);

	record(readLegacyFolders(data.elaboration?.detection?.excludeFolders), 'elaboration');
	record(enrichmentFolders, 'enrichment');
	record(readLegacyFolders(data.summarize?.excludeFolders), 'summarize');
	record(readLegacyFolders(data.organize?.excludeFolders), 'organize');
	record(readLegacyFolders(data.deepDive?.excludeFolders), 'deep-dive');
	// rem reused enrichment's folder list at runtime (no list of its own).
	record(enrichmentFolders, 'rem');

	const totalLegacyFeatures = LEGACY_FOLDER_FEATURES.length;
	const rules: ExclusionRule[] = [];
	for (const [pattern, features] of byPattern) {
		if (features.size === totalLegacyFeatures) {
			rules.push({ pattern, features: 'all' });
		} else {
			// Emit in canonical feature order for stable, comparable output.
			const ordered = LEGACY_FOLDER_FEATURES.filter((f) => features.has(f));
			rules.push({ pattern, features: ordered });
		}
	}
	return rules;
}
