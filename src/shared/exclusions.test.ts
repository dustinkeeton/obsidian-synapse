import { describe, it, expect } from 'vitest';
import {
	findMatchingRule,
	isPathExcluded,
	matchesExcludeTag,
	buildMigratedExclusions,
	type ExclusionRule,
	type FeatureId,
	type LegacyModuleExclusions,
} from './exclusions';
import { TFile } from '../__mocks__/obsidian';

/**
 * Build a minimal settings-shaped object carrying only the `exclusions` list.
 * The matcher reads nothing else off settings, so this stays deliberately thin
 * (cast through `unknown` to the matcher's narrow `{ exclusions }` contract).
 */
function settingsWith(exclusions: ExclusionRule[]): { exclusions: ExclusionRule[] } {
	return { exclusions };
}

describe('findMatchingRule / isPathExcluded — glob semantics', () => {
	describe('folder + descendants (`dir/**`)', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/**', features: 'all' }];

		it('matches a nested descendant', () => {
			expect(isPathExcluded('dir/note.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('matches a deeply nested descendant', () => {
			expect(isPathExcluded('dir/sub/deep/note.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('does NOT match the folder itself', () => {
			expect(isPathExcluded('dir', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('does NOT match a sibling file sharing the prefix (`dir.md`)', () => {
			expect(isPathExcluded('dir.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('does NOT match a sibling folder sharing the prefix (`dirX/...`)', () => {
			expect(isPathExcluded('dirX/note.md', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('direct children only (`dir/*`)', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/*', features: 'all' }];

		it('matches a direct child', () => {
			expect(isPathExcluded('dir/note.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('does NOT match a grandchild', () => {
			expect(isPathExcluded('dir/sub/note.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('does NOT match the folder itself', () => {
			expect(isPathExcluded('dir', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('exact file path (has slash, no wildcard)', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/note.md', features: 'all' }];

		it('matches itself exactly', () => {
			expect(isPathExcluded('dir/note.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('does NOT match a different file in the same folder', () => {
			expect(isPathExcluded('dir/other.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('does NOT match a descendant path that extends it', () => {
			expect(isPathExcluded('dir/note.md/child.md', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('bare token (no slash, no wildcard) — recursive prefix parity', () => {
		const rules: ExclusionRule[] = [{ pattern: 'templates', features: 'all' }];

		it('matches a nested descendant (legacy startsWith parity)', () => {
			expect(isPathExcluded('templates/daily.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('matches the bare folder itself', () => {
			expect(isPathExcluded('templates', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('does NOT match a sibling sharing the prefix (`templatesX/...`)', () => {
			expect(isPathExcluded('templatesX/a.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('does NOT match a file sharing the prefix (`templates.md`)', () => {
			expect(isPathExcluded('templates.md', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('regex metacharacter escaping (`.synapse/**`)', () => {
		const rules: ExclusionRule[] = [{ pattern: '.synapse/**', features: 'all' }];

		it('matches a real `.synapse` descendant', () => {
			expect(isPathExcluded('.synapse/proposals/a.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('does NOT over-match when `.` is treated literally (`Xsynapse/a.md`)', () => {
			expect(isPathExcluded('Xsynapse/a.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('does NOT over-match `asynapse/a.md` either', () => {
			expect(isPathExcluded('asynapse/a.md', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('trailing-slash normalization', () => {
		it('treats `dir/` (one trailing slash) as the `dir` folder, matching descendants', () => {
			const rules: ExclusionRule[] = [{ pattern: 'dir/', features: 'all' }];
			expect(isPathExcluded('dir/note.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('treats `dir/**/` as `dir/**`', () => {
			const rules: ExclusionRule[] = [{ pattern: 'dir/**/', features: 'all' }];
			expect(isPathExcluded('dir/sub/note.md', 'enrichment', settingsWith(rules))).toBe(true);
			expect(isPathExcluded('dir', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('empty / whitespace patterns match nothing', () => {
		it('an empty pattern never matches', () => {
			const rules: ExclusionRule[] = [{ pattern: '', features: 'all' }];
			expect(isPathExcluded('anything/at/all.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('a whitespace-only pattern never matches', () => {
			const rules: ExclusionRule[] = [{ pattern: '   ', features: 'all' }];
			expect(isPathExcluded('anything.md', 'enrichment', settingsWith(rules))).toBe(false);
		});

		it('a lone slash never matches everything', () => {
			const rules: ExclusionRule[] = [{ pattern: '/', features: 'all' }];
			expect(isPathExcluded('anything.md', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});

	describe('case sensitivity', () => {
		const rules: ExclusionRule[] = [{ pattern: 'Templates/**', features: 'all' }];

		it('matches the exact case', () => {
			expect(isPathExcluded('Templates/a.md', 'enrichment', settingsWith(rules))).toBe(true);
		});

		it('does NOT match a different case', () => {
			expect(isPathExcluded('templates/a.md', 'enrichment', settingsWith(rules))).toBe(false);
		});
	});
});

describe('findMatchingRule / isPathExcluded — feature scoping', () => {
	it('a feature-scoped rule does NOT match a different feature', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/**', features: ['organize'] }];
		expect(isPathExcluded('dir/a.md', 'enrichment', settingsWith(rules))).toBe(false);
	});

	it('a feature-scoped rule matches its own feature', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/**', features: ['organize'] }];
		expect(isPathExcluded('dir/a.md', 'organize', settingsWith(rules))).toBe(true);
	});

	it("`features: 'all'` matches every feature", () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/**', features: 'all' }];
		const everyFeature: FeatureId[] = [
			'elaboration', 'enrichment', 'summarize', 'tidy', 'organize',
			'deep-dive', 'audio', 'video', 'title', 'image', 'rem', 'intake',
		];
		for (const feature of everyFeature) {
			expect(isPathExcluded('dir/a.md', feature, settingsWith(rules))).toBe(true);
		}
	});

	it('`features: []` matches nothing', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/**', features: [] }];
		expect(isPathExcluded('dir/a.md', 'enrichment', settingsWith(rules))).toBe(false);
	});

	it('a multi-feature list matches any listed feature', () => {
		const rules: ExclusionRule[] = [{ pattern: 'dir/**', features: ['enrichment', 'summarize'] }];
		expect(isPathExcluded('dir/a.md', 'enrichment', settingsWith(rules))).toBe(true);
		expect(isPathExcluded('dir/a.md', 'summarize', settingsWith(rules))).toBe(true);
		expect(isPathExcluded('dir/a.md', 'organize', settingsWith(rules))).toBe(false);
	});
});

describe('findMatchingRule — determinism (first match wins)', () => {
	it('returns the FIRST matching rule in array order', () => {
		const rules: ExclusionRule[] = [
			{ pattern: 'dir/**', features: 'all' },
			{ pattern: 'dir/note.md', features: 'all' },
		];
		const rule = findMatchingRule('dir/note.md', 'enrichment', settingsWith(rules));
		expect(rule).not.toBeNull();
		expect(rule?.pattern).toBe('dir/**');
	});

	it('skips a non-applicable (feature-scoped) earlier rule and returns the next match', () => {
		const rules: ExclusionRule[] = [
			{ pattern: 'dir/**', features: ['organize'] },
			{ pattern: 'dir/**', features: ['enrichment'] },
		];
		const rule = findMatchingRule('dir/a.md', 'enrichment', settingsWith(rules));
		expect(rule?.features).toEqual(['enrichment']);
	});

	it('returns null when no rule applies', () => {
		const rules: ExclusionRule[] = [{ pattern: 'other/**', features: 'all' }];
		expect(findMatchingRule('dir/a.md', 'enrichment', settingsWith(rules))).toBeNull();
	});

	it('returns null for an empty exclusions list', () => {
		expect(findMatchingRule('dir/a.md', 'enrichment', settingsWith([]))).toBeNull();
		expect(isPathExcluded('dir/a.md', 'enrichment', settingsWith([]))).toBe(false);
	});

	it('tolerates a missing/undefined exclusions list (partial settings) without throwing', () => {
		const partial = {} as unknown as { exclusions: ExclusionRule[] };
		expect(findMatchingRule('dir/a.md', 'enrichment', partial)).toBeNull();
		expect(isPathExcluded('dir/a.md', 'enrichment', partial)).toBe(false);
	});
});

describe('matchesExcludeTag', () => {
	function fileWithTags(tags: unknown) {
		// Cast through `never`: the centralized mock's TFile is structurally a
		// stand-in for obsidian's, and matchesExcludeTag only forwards it to
		// metadataCache.getFileCache (also a stub here).
		const file = new TFile('note.md') as never;
		const metadataCache = {
			getFileCache: () => (tags === undefined ? null : { frontmatter: { tags } }),
		};
		return { file, metadataCache };
	}

	it('matches a frontmatter tag (no `#` on either side)', () => {
		const { file, metadataCache } = fileWithTags(['no-enrich']);
		expect(matchesExcludeTag(file, ['no-enrich'], metadataCache as never)).toBe(true);
	});

	it('strips a leading `#` from the configured exclude tag before comparing', () => {
		const { file, metadataCache } = fileWithTags(['no-enrich']);
		expect(matchesExcludeTag(file, ['#no-enrich'], metadataCache as never)).toBe(true);
	});

	it('strips a leading `#` from the frontmatter tag before comparing', () => {
		const { file, metadataCache } = fileWithTags(['#no-enrich']);
		expect(matchesExcludeTag(file, ['no-enrich'], metadataCache as never)).toBe(true);
	});

	it('matches when both sides carry `#`', () => {
		const { file, metadataCache } = fileWithTags(['#no-enrich']);
		expect(matchesExcludeTag(file, ['#no-enrich'], metadataCache as never)).toBe(true);
	});

	it('returns false when no tag matches', () => {
		const { file, metadataCache } = fileWithTags(['keep']);
		expect(matchesExcludeTag(file, ['no-enrich'], metadataCache as never)).toBe(false);
	});

	it('returns false when the note has no frontmatter cache', () => {
		const { file, metadataCache } = fileWithTags(undefined);
		expect(matchesExcludeTag(file, ['no-enrich'], metadataCache as never)).toBe(false);
	});

	it('returns false for an empty exclude-tag list', () => {
		const { file, metadataCache } = fileWithTags(['no-enrich']);
		expect(matchesExcludeTag(file, [], metadataCache as never)).toBe(false);
	});

	it('handles a comma-separated frontmatter tags string', () => {
		const { file, metadataCache } = fileWithTags('keep, no-enrich');
		expect(matchesExcludeTag(file, ['no-enrich'], metadataCache as never)).toBe(true);
	});
});

describe('buildMigratedExclusions', () => {
	it('returns [] for empty / missing legacy data (idempotent: already-migrated data has no folders)', () => {
		expect(buildMigratedExclusions({})).toEqual([]);
		expect(buildMigratedExclusions({ enrichment: {} })).toEqual([]);
		expect(buildMigratedExclusions({ enrichment: { excludeFolders: [] } })).toEqual([]);
	});

	it('collapses to features: "all" when a folder is in EVERY legacy module', () => {
		const legacy: LegacyModuleExclusions = {
			elaboration: { detection: { excludeFolders: ['.synapse'] } },
			enrichment: { excludeFolders: ['.synapse'] },
			summarize: { excludeFolders: ['.synapse'] },
			organize: { excludeFolders: ['.synapse'] },
			deepDive: { excludeFolders: ['.synapse'] },
		};
		// enrichment list also feeds rem → all 6 legacy features present.
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: '.synapse/**', features: 'all' },
		]);
	});

	it('canonicalizes a bare folder name to "<name>/**"', () => {
		const legacy: LegacyModuleExclusions = {
			summarize: { excludeFolders: ['Archive'] },
		};
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: 'Archive/**', features: ['summarize'] },
		]);
	});

	it('strips a trailing slash before appending /**', () => {
		const legacy: LegacyModuleExclusions = {
			organize: { excludeFolders: ['Archive/'] },
		};
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: 'Archive/**', features: ['organize'] },
		]);
	});

	it('keeps a custom single-module folder scoped to that feature', () => {
		const legacy: LegacyModuleExclusions = {
			organize: { excludeFolders: ['Personal'] },
		};
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: 'Personal/**', features: ['organize'] },
		]);
	});

	it("includes 'rem' wherever enrichment listed a folder (rem mirrors enrichment)", () => {
		const legacy: LegacyModuleExclusions = {
			enrichment: { excludeFolders: ['Drafts'] },
		};
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: 'Drafts/**', features: ['enrichment', 'rem'] },
		]);
	});

	it('merges the same folder across a partial set of modules into one scoped rule', () => {
		const legacy: LegacyModuleExclusions = {
			summarize: { excludeFolders: ['Notes'] },
			organize: { excludeFolders: ['Notes'] },
		};
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: 'Notes/**', features: ['summarize', 'organize'] },
		]);
	});

	it('emits one rule per distinct folder, mixing all-scope and feature-scope', () => {
		const legacy: LegacyModuleExclusions = {
			elaboration: { detection: { excludeFolders: ['templates'] } },
			enrichment: { excludeFolders: ['templates'] },
			summarize: { excludeFolders: ['templates'] },
			organize: { excludeFolders: ['templates', 'Personal'] },
			deepDive: { excludeFolders: ['templates'] },
		};
		const result = buildMigratedExclusions(legacy);
		// `templates` is in all → 'all'; `Personal` only in organize → scoped.
		expect(result).toContainEqual({ pattern: 'templates/**', features: 'all' });
		expect(result).toContainEqual({ pattern: 'Personal/**', features: ['organize'] });
		expect(result).toHaveLength(2);
	});

	it('is deterministic — same input yields equal output across calls', () => {
		const legacy: LegacyModuleExclusions = {
			enrichment: { excludeFolders: ['A', 'B'] },
			organize: { excludeFolders: ['B', 'C'] },
		};
		expect(buildMigratedExclusions(legacy)).toEqual(buildMigratedExclusions(legacy));
	});

	it('ignores non-string / blank legacy folder entries', () => {
		const legacy = {
			summarize: { excludeFolders: ['Real', '', '   ', 42, null] },
		} as unknown as LegacyModuleExclusions;
		expect(buildMigratedExclusions(legacy)).toEqual([
			{ pattern: 'Real/**', features: ['summarize'] },
		]);
	});
});
