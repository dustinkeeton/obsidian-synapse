import type { App, CachedMetadata, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { normalizeFrontmatterTags, getIncludedMarkdownFiles } from '../shared';
import { buildSkipRegions, isInSkipRegion, isWordBoundary, type SkipRegion } from './skip-regions';
import type { RemLinkCandidate, RemOccurrence } from './types';

/** Entry in the lookup table: a term and the note it maps to. */
interface LookupEntry {
	/** The term to search for (lowercased) */
	term: string;
	/** Original-case term for display */
	originalTerm: string;
	/** Path to the target note */
	targetPath: string;
	/** Display name for the target note */
	targetDisplayName: string;
	/** Whether this entry came from an alias */
	isAlias: boolean;
}

/**
 * Scans note content for literal mentions of other vault note titles and aliases.
 * Returns link candidates with precise occurrence positions.
 */
export class MentionScanner {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	/**
	 * Scan a note's content for mentions of other vault notes.
	 *
	 * @param sourceFile - The note being scanned
	 * @param content - The raw text of the note
	 * @param maxLinks - Maximum number of link candidates to return
	 * @returns Array of link candidates, sorted by number of occurrences (descending)
	 */
	scan(sourceFile: TFile, content: string, maxLinks: number): RemLinkCandidate[] {
		const lookup = this.buildLookupTable(sourceFile.path);
		if (lookup.length === 0) return [];

		const skipRegions = buildSkipRegions(content);
		const lines = content.split('\n');

		// Track matches: key = targetPath + matchedText
		const matchMap = new Map<string, {
			entry: LookupEntry;
			occurrences: RemOccurrence[];
		}>();

		let lineOffset = 0;
		for (let lineNum = 0; lineNum < lines.length; lineNum++) {
			const line = lines[lineNum];
			this.scanLine(line, lineNum, lineOffset, lookup, skipRegions, matchMap);
			lineOffset += line.length + 1; // +1 for the newline
		}

		// Convert to candidates
		const candidates: RemLinkCandidate[] = [];
		for (const { entry, occurrences } of matchMap.values()) {
			if (occurrences.length === 0) continue;
			candidates.push({
				targetPath: entry.targetPath,
				targetDisplayName: entry.targetDisplayName,
				matchedText: entry.originalTerm,
				matchType: entry.isAlias ? 'alias' : 'title',
				occurrences,
				confidence: 1.0,
			});
		}

		// Sort by occurrence count (most references first), then by earliest position
		candidates.sort((a, b) => {
			const countDiff = b.occurrences.length - a.occurrences.length;
			if (countDiff !== 0) return countDiff;
			return a.occurrences[0].lineNumber - b.occurrences[0].lineNumber;
		});

		return candidates.slice(0, maxLinks);
	}

	/**
	 * Build a lookup table of all vault note titles and aliases,
	 * sorted by term length descending (longest-match-first).
	 */
	private buildLookupTable(sourceFilePath: string): LookupEntry[] {
		const entries: LookupEntry[] = [];
		const files = getIncludedMarkdownFiles(this.app, 'rem', this.getSettings());

		for (const file of files) {
			// Skip self-references
			if (file.path === sourceFilePath) continue;

			const displayName = file.basename;

			// Skip very short names (1-2 chars) — too noisy
			if (displayName.length < 3) continue;

			// Add title entry
			entries.push({
				term: displayName.toLowerCase(),
				originalTerm: displayName,
				targetPath: file.path,
				targetDisplayName: displayName,
				isAlias: false,
			});

			// Add alias entries
			const cache: CachedMetadata | null = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter?.aliases) {
				const aliases = normalizeFrontmatterTags(cache.frontmatter.aliases);

				for (const alias of aliases) {
					if (typeof alias !== 'string' || alias.length < 3) continue;
					entries.push({
						term: alias.toLowerCase(),
						originalTerm: alias,
						targetPath: file.path,
						targetDisplayName: displayName,
						isAlias: true,
					});
				}
			}
		}

		// Sort by term length descending — longest match first
		entries.sort((a, b) => b.term.length - a.term.length);

		return entries;
	}

	/**
	 * Scan a single line for term matches.
	 */
	private scanLine(
		line: string,
		lineNumber: number,
		lineOffset: number,
		lookup: LookupEntry[],
		skipRegions: SkipRegion[],
		matchMap: Map<string, { entry: LookupEntry; occurrences: RemOccurrence[] }>
	): void {
		const lineLower = line.toLowerCase();
		// Track which character positions in this line have already been claimed
		const claimed = new Set<number>();

		for (const entry of lookup) {
			let searchFrom = 0;
			while (searchFrom <= lineLower.length - entry.term.length) {
				const idx = lineLower.indexOf(entry.term, searchFrom);
				if (idx === -1) break;

				const end = idx + entry.term.length;

				// Check word boundaries
				if (!isWordBoundary(lineLower, idx, end)) {
					searchFrom = idx + 1;
					continue;
				}

				// Check if any character in this range is already claimed (longest-match-first)
				let overlap = false;
				for (let c = idx; c < end; c++) {
					if (claimed.has(c)) {
						overlap = true;
						break;
					}
				}
				if (overlap) {
					searchFrom = idx + 1;
					continue;
				}

				// Check skip regions
				const absStart = lineOffset + idx;
				const absEnd = lineOffset + end;
				if (isInSkipRegion(absStart, absEnd, skipRegions)) {
					searchFrom = idx + 1;
					continue;
				}

				// Record the match
				const key = `${entry.targetPath}::${entry.term}`;
				if (!matchMap.has(key)) {
					matchMap.set(key, { entry, occurrences: [] });
				}
				matchMap.get(key)!.occurrences.push({
					lineNumber,
					lineText: line,
					startOffset: idx,
					endOffset: end,
				});

				// Claim these positions
				for (let c = idx; c < end; c++) {
					claimed.add(c);
				}

				searchFrom = end;
			}
		}
	}
}

