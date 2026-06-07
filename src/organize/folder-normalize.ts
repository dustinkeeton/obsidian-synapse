/**
 * Folder-name normalization for the organize module (#172).
 *
 * Equivalent topic labels ("model" vs "models", "machine learning" vs
 * "machine-learning") should coalesce to a single folder. These pure helpers
 * provide a canonical, morphology-aware key used for:
 *   1. emitting new folder names in canonical (singular) form,
 *   2. matching topics against existing directories, and
 *   3. deduplicating proposed directories within a batch scan.
 *
 * Scope is deliberately singular/plural only — no abbreviation/synonym map.
 * Singularization is rule-based and biased toward NOT mangling words: when a
 * rule is ambiguous it prefers leaving the word intact over producing a
 * non-word. Known collisions are handled by the curated sets below, which are
 * expected to grow as edge cases surface in tests.
 */

/** Words ending in s/es/ies that are already singular (or mass nouns). */
const UNCOUNTABLE = new Set([
	'news', 'series', 'species', 'physics', 'mathematics', 'economics',
	'politics', 'ethics', 'statistics', 'analytics', 'status', 'focus',
	'virus', 'bonus', 'corpus', 'campus', 'census', 'chaos', 'kudos',
	'ethos', 'pathos', 'cosmos', 'analysis', 'basis', 'crisis', 'thesis',
	'axis', 'oasis', 'diagnosis', 'synthesis', 'hypothesis', 'lens',
]);

/** Irregular plural -> singular forms. */
const IRREGULAR: Record<string, string> = {
	children: 'child',
	people: 'person',
	men: 'man',
	women: 'woman',
	feet: 'foot',
	teeth: 'tooth',
	geese: 'goose',
	mice: 'mouse',
};

/**
 * Plural forms the generic rules would mangle (singular keeps a trailing "e",
 * but the suffix looks like a sibilant cluster). Add to this map as needed.
 */
const OVERRIDE: Record<string, string> = {
	caches: 'cache',
	niches: 'niche',
};

/**
 * Words ending in "ies" whose singular is "...ie" (just drop the "s"), not the
 * "y" form ("category" <- "categories"). Without this list, "movies" would
 * incorrectly become "movy".
 */
const IE_PLURALS = new Set([
	'movies', 'cookies', 'zombies', 'calories', 'newbies', 'genies',
	'rookies', 'brownies', 'pies', 'ties', 'lies', 'dies',
]);

/**
 * Reduce a single word to a naive singular form. Idempotent: applying it to an
 * already-singular word returns that word unchanged.
 */
export function singularize(input: string): string {
	const word = input.toLowerCase();

	if (OVERRIDE[word]) return OVERRIDE[word];
	if (IRREGULAR[word]) return IRREGULAR[word];
	if (word.length <= 3 || UNCOUNTABLE.has(word)) return word;

	// "categories" -> "category", but "movies" -> "movie"
	if (word.endsWith('ies') && word.length > 4) {
		if (IE_PLURALS.has(word)) return word.slice(0, -1);
		const before = word[word.length - 4];
		if (!'aeiou'.includes(before)) return word.slice(0, -3) + 'y';
	}

	// "classes" -> "class", "boxes" -> "box", "watches" -> "watch",
	// but "phases" -> "phase", "pages" -> "page" (stem keeps its "e").
	if (word.endsWith('es')) {
		const stem = word.slice(0, -2);
		if (/(?:ss|x|ch|sh)$/.test(stem)) return stem;
		return word.slice(0, -1);
	}

	// "models" -> "model", "videos" -> "video"; leave "class", "status",
	// "analysis", "axis" intact.
	if (word.endsWith('s') && !/(?:ss|us|sis|xis)$/.test(word)) {
		return word.slice(0, -1);
	}

	return word;
}

/**
 * Canonical comparison key for a topic label or directory name. Lowercases,
 * collapses every non-alphanumeric run to a word boundary, singularizes each
 * word, and rejoins with "-". This unifies casing, punctuation, and
 * space-vs-hyphen ("Machine Learning" === "machine-learning") in addition to
 * singular/plural. Intended for comparison/dedup, never shown to the user.
 */
export function canonicalKey(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map(singularize)
		.join('-');
}

/** Levenshtein edit distance (single-row dynamic programming). */
export function editDistance(a: string, b: string): number {
	if (a === b) return 0;
	const m = a.length;
	const n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;

	const row = Array.from({ length: n + 1 }, (_, i) => i);
	for (let i = 1; i <= m; i++) {
		let prevDiag = row[0];
		row[0] = i;
		for (let j = 1; j <= n; j++) {
			const tmp = row[j];
			row[j] = Math.min(
				row[j] + 1,
				row[j - 1] + 1,
				prevDiag + (a[i - 1] === b[j - 1] ? 0 : 1)
			);
			prevDiag = tmp;
		}
	}
	return row[n];
}

/**
 * Conservative near-match test for two canonical keys. Requires both keys to be
 * reasonably long (>= 6 chars) so short, semantically distinct words like
 * "node"/"code" or "table"/"cable" never match; within that, allows a single
 * edit (one typo). Used only as a weak scoring tier and for batch dedup.
 */
export function isFuzzyMatch(a: string, b: string): boolean {
	if (a === b) return true;
	if (Math.min(a.length, b.length) < 6) return false;
	return editDistance(a, b) <= 1;
}
