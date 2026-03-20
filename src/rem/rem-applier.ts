import type { RemLinkCandidate, RemOccurrence } from './types';

/**
 * Applies accepted wikilink insertions to note content.
 * Replaces matched text with `[[target|matchedText]]` (or `[[target]]`
 * if the matched text equals the display name).
 *
 * Processes replacements in reverse document order (bottom-up, right-to-left)
 * so that earlier offsets remain valid as content is modified.
 */
export class RemApplier {
	/**
	 * Apply accepted link candidates to the note content.
	 *
	 * @param content - Original note content
	 * @param candidates - The accepted link candidates to apply
	 * @returns Modified content with wikilinks inserted
	 */
	apply(content: string, candidates: RemLinkCandidate[]): string {
		// Collect all individual replacements
		const replacements: Array<{
			lineNumber: number;
			startOffset: number;
			endOffset: number;
			replacement: string;
		}> = [];

		for (const candidate of candidates) {
			const wikilink = this.buildWikilink(candidate);

			for (const occ of candidate.occurrences) {
				replacements.push({
					lineNumber: occ.lineNumber,
					startOffset: occ.startOffset,
					endOffset: occ.endOffset,
					replacement: wikilink,
				});
			}
		}

		// Sort in reverse document order: higher line numbers first,
		// then higher start offsets first within the same line
		replacements.sort((a, b) => {
			const lineDiff = b.lineNumber - a.lineNumber;
			if (lineDiff !== 0) return lineDiff;
			return b.startOffset - a.startOffset;
		});

		// Apply replacements
		const lines = content.split('\n');

		for (const rep of replacements) {
			if (rep.lineNumber >= lines.length) continue;
			const line = lines[rep.lineNumber];
			lines[rep.lineNumber] =
				line.slice(0, rep.startOffset) +
				rep.replacement +
				line.slice(rep.endOffset);
		}

		return lines.join('\n');
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
