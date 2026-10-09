import type { RemLinkCandidate, RemOccurrence } from './types';
import { buildSkipRegions, isInSkipRegion, isWordBoundary, lineStartOffsets } from './skip-regions';

/** Outcome of {@link RemApplier.apply}: the new content plus what was actually linked. */
export interface RemApplyResult {
	content: string;
	/** Occurrences spliced into the content. */
	applied: number;
	/** Occurrences that no longer matched the content and could not be re-located. */
	dropped: number;
	/** Candidates with at least one applied occurrence. */
	appliedCandidates: RemLinkCandidate[];
}

interface Span {
	lineNumber: number;
	startOffset: number;
	endOffset: number;
}

/**
 * Applies accepted wikilink insertions to note content.
 * Replaces matched text with `[[target|matchedText]]` (or `[[target]]`
 * if the matched text equals the display name).
 *
 * Scan-time offsets are validated against the content being written; an occurrence
 * whose text moved is re-located, and one that cannot be found is dropped.
 */
export class RemApplier {
	/**
	 * Apply accepted link candidates to the note content.
	 *
	 * @param content - Current note content
	 * @param candidates - The accepted link candidates to apply
	 * @returns The modified content and counts of applied/dropped occurrences
	 */
	apply(content: string, candidates: RemLinkCandidate[]): RemApplyResult {
		const lines = content.split('\n');
		const lineStarts = lineStartOffsets(lines);
		const skipRegions = buildSkipRegions(content);
		const claimed: Span[] = [];
		const replacements: Array<Span & { replacement: string }> = [];
		const appliedCandidates = new Set<RemLinkCandidate>();
		const stale: Array<{ candidate: RemLinkCandidate; occ: RemOccurrence }> = [];
		let dropped = 0;

		const isFree = (span: Span) => !claimed.some(c =>
			c.lineNumber === span.lineNumber && span.startOffset < c.endOffset && c.startOffset < span.endOffset);
		const isLinkable = (lineNumber: number, start: number, end: number) =>
			!isInSkipRegion(lineStarts[lineNumber] + start, lineStarts[lineNumber] + end, skipRegions);
		const claim = (candidate: RemLinkCandidate, span: Span) => {
			claimed.push(span);
			replacements.push({ ...span, replacement: this.buildWikilink(candidate) });
			appliedCandidates.add(candidate);
		};

		// Exact positions first so a re-located occurrence can never steal a still-valid span.
		for (const candidate of candidates) {
			const needle = candidate.matchedText.toLowerCase();
			for (const occ of candidate.occurrences) {
				const line = lines[occ.lineNumber];
				const span: Span = { lineNumber: occ.lineNumber, startOffset: occ.startOffset, endOffset: occ.endOffset };
				const valid = line !== undefined
					&& occ.endOffset - occ.startOffset === needle.length
					&& line.slice(occ.startOffset, occ.endOffset).toLowerCase() === needle
					&& (line === occ.lineText || isWordBoundary(line, occ.startOffset, occ.endOffset))
					&& isLinkable(occ.lineNumber, occ.startOffset, occ.endOffset);
				if (valid && isFree(span)) claim(candidate, span);
				else stale.push({ candidate, occ });
			}
		}

		for (const { candidate, occ } of stale) {
			const span = this.relocate(lines, candidate.matchedText.toLowerCase(), occ, s => isFree(s) && isLinkable(s.lineNumber, s.startOffset, s.endOffset));
			if (span) claim(candidate, span);
			else dropped++;
		}

		// Reverse document order keeps earlier offsets valid while splicing.
		replacements.sort((a, b) => b.lineNumber - a.lineNumber || b.startOffset - a.startOffset);
		for (const rep of replacements) {
			const line = lines[rep.lineNumber];
			lines[rep.lineNumber] = line.slice(0, rep.startOffset) + rep.replacement + line.slice(rep.endOffset);
		}

		return {
			content: lines.join('\n'),
			applied: replacements.length,
			dropped,
			appliedCandidates: candidates.filter(c => appliedCandidates.has(c)),
		};
	}

	/** Nearest whole-word match of `needle`: same line first, then by line distance. */
	private relocate(lines: string[], needle: string, occ: RemOccurrence, accept: (span: Span) => boolean): Span | null {
		if (needle.length === 0) return null;
		let best: { span: Span; lineDistance: number; charDistance: number } | null = null;
		for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
			const lower = lines[lineNumber].toLowerCase();
			const lineDistance = Math.abs(lineNumber - occ.lineNumber);
			for (let idx = lower.indexOf(needle); idx !== -1; idx = lower.indexOf(needle, idx + 1)) {
				const span: Span = { lineNumber, startOffset: idx, endOffset: idx + needle.length };
				if (!isWordBoundary(lower, span.startOffset, span.endOffset) || !accept(span)) continue;
				const charDistance = Math.abs(idx - occ.startOffset);
				if (!best || lineDistance < best.lineDistance
					|| (lineDistance === best.lineDistance && charDistance < best.charDistance)) {
					best = { span, lineDistance, charDistance };
				}
			}
		}
		return best?.span ?? null;
	}

	/**
	 * Build the wikilink string for a candidate.
	 * Uses `[[displayName]]` when the matched text equals the display name,
	 * otherwise uses `[[displayName|matchedText]]` to preserve the original phrasing.
	 */
	private buildWikilink(candidate: RemLinkCandidate): string {
		if (candidate.matchedText.toLowerCase() === candidate.targetDisplayName.toLowerCase()) {
			return `[[${candidate.targetDisplayName}]]`;
		}
		return `[[${candidate.targetDisplayName}|${candidate.matchedText}]]`;
	}
}
