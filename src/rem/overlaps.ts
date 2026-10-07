import type { RemLinkCandidate, RemOccurrence } from './types';

/** Drop occurrences overlapping one claimed by an earlier candidate, then candidates left with none; keeps input order. */
export function withoutOverlaps(candidates: RemLinkCandidate[]): RemLinkCandidate[] {
	const claimed: RemOccurrence[] = [];
	const overlaps = (a: RemOccurrence, b: RemOccurrence) =>
		a.lineNumber === b.lineNumber && a.startOffset < b.endOffset && b.startOffset < a.endOffset;
	const kept: RemLinkCandidate[] = [];
	for (const candidate of candidates) {
		const occurrences = candidate.occurrences.filter(o => !claimed.some(c => overlaps(o, c)));
		if (occurrences.length === 0) continue;
		claimed.push(...occurrences);
		kept.push(occurrences.length === candidate.occurrences.length ? candidate : { ...candidate, occurrences });
	}
	return kept;
}
