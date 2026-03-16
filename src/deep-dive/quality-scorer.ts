import type { QualityScore } from './types';

/** Common words that indicate a generic/low-value topic. */
const GENERIC_TITLES = new Set([
	'introduction',
	'overview',
	'summary',
	'conclusion',
	'background',
	'basics',
	'fundamentals',
	'concepts',
	'details',
	'notes',
	'misc',
	'other',
	'general',
]);

/**
 * Local heuristic scorer — no AI call.
 *
 * Weights:
 * - Topic count   (0.3): min(1.0, childTopics / 3)
 * - Word count    (0.2): min(1.0, wordCount / 200)
 * - Generic pen.  (0.2): penalize 1-word titles or common words
 * - Overlap pen.  (0.2): fraction of child topics in ancestor list
 * - Depth decay   (0.1): 1.0 - (depth / maxDepth * 0.5)
 */
export function scoreQuality(opts: {
	title: string;
	childTopicTitles: string[];
	wordCount: number;
	depth: number;
	maxDepth: number;
	ancestorTopics: string[];
}): QualityScore {
	const { title, childTopicTitles, wordCount, depth, maxDepth, ancestorTopics } = opts;

	// ── Topic count (0.3) ──
	const topicScore = Math.min(1.0, childTopicTitles.length / 3);

	// ── Word count (0.2) ──
	const wordScore = Math.min(1.0, wordCount / 200);

	// ── Generic penalty (0.2) ──
	const words = title.toLowerCase().split(/\s+/).filter(Boolean);
	const isTooGeneric =
		words.length <= 1 ||
		words.some(w => GENERIC_TITLES.has(w));
	const genericScore = isTooGeneric ? 0.3 : 1.0;

	// ── Overlap penalty (0.2) ──
	const ancestorSet = new Set(ancestorTopics.map(t => t.toLowerCase()));
	const overlapping = childTopicTitles.filter(t => ancestorSet.has(t.toLowerCase()));
	const overlapRatio = childTopicTitles.length > 0
		? overlapping.length / childTopicTitles.length
		: 0;
	const hasHighOverlap = overlapRatio > 0.5;
	const overlapScore = 1.0 - overlapRatio;

	// ── Depth decay (0.1) ──
	const depthScore = maxDepth > 0
		? 1.0 - (depth / maxDepth * 0.5)
		: 1.0;

	// ── Weighted total ──
	const score =
		topicScore * 0.3 +
		wordScore * 0.2 +
		genericScore * 0.2 +
		overlapScore * 0.2 +
		depthScore * 0.1;

	// ── Reasoning ──
	const parts: string[] = [];
	if (childTopicTitles.length < 3) parts.push(`low topic count (${childTopicTitles.length})`);
	if (wordCount < 200) parts.push(`short content (${wordCount} words)`);
	if (isTooGeneric) parts.push('generic title');
	if (hasHighOverlap) parts.push(`${overlapping.length}/${childTopicTitles.length} topics overlap with ancestors`);
	if (depth >= maxDepth - 1) parts.push(`near max depth (${depth}/${maxDepth})`);

	const reasoning = parts.length > 0
		? `Score ${score.toFixed(2)}: ${parts.join('; ')}`
		: `Score ${score.toFixed(2)}: good quality`;

	return {
		score: Math.round(score * 100) / 100,
		topicCount: childTopicTitles.length,
		wordCount,
		isTooGeneric,
		hasHighOverlap,
		reasoning,
	};
}
