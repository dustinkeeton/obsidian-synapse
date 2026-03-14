import { App, TFile } from 'obsidian';
import { AutoNotesSettings } from '../settings';
import { InternalLinkCandidate, WeightConfig } from './types';
import { VaultAnalyzer } from './vault-analyzer';
import { computeProximityWeight } from './weight-calculator';

/**
 * Finds internal link candidates for a note.
 * Strategy: liberal — low threshold, many suggestions.
 *
 * Candidates come from:
 * 1. Files 1-2 hops away in the link graph.
 * 2. Files sharing 2+ tags with the note.
 * 3. Files in the same or sibling folders.
 *
 * Each candidate is scored by proximity + shared tag overlap.
 */
export class LinkResolver {
	constructor(
		private app: App,
		private analyzer: VaultAnalyzer,
		private getSettings: () => AutoNotesSettings
	) {}

	findInternalLinks(
		file: TFile,
		existingLinkPaths: string[]
	): InternalLinkCandidate[] {
		const settings = this.getSettings().enrichment;
		const weights = settings.weights;
		const fileTags = new Set(this.analyzer.getFileTags(file));

		// Collect candidate files from multiple sources
		const candidates = new Map<string, { score: number; reasons: string[] }>();

		this.addLinkGraphCandidates(file.path, candidates, weights, existingLinkPaths);
		this.addSharedTagCandidates(file, fileTags, candidates, weights, existingLinkPaths);
		this.addProximityCandidates(file, candidates, weights, existingLinkPaths);

		// Filter by threshold, sort, and format
		const results: InternalLinkCandidate[] = [];

		for (const [targetPath, data] of candidates) {
			if (data.score < settings.internalLinkThreshold) continue;

			const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (!(targetFile instanceof TFile)) continue;

			const displayText = this.app.metadataCache.fileToLinktext(
				targetFile,
				file.path,
				true
			);

			results.push({
				targetPath,
				displayText,
				relevanceScore: data.score,
				reason: data.reasons.join('; '),
			});
		}

		results.sort((a, b) => b.relevanceScore - a.relevanceScore);
		return results.slice(0, settings.maxInternalLinks);
	}

	private addLinkGraphCandidates(
		filePath: string,
		candidates: Map<string, { score: number; reasons: string[] }>,
		weights: WeightConfig,
		existingLinks: string[]
	): void {
		const directLinks = new Set([
			...this.analyzer.getOutgoingLinks(filePath),
			...this.analyzer.getIncomingLinks(filePath),
		]);

		// 2nd-hop: files linked from direct links
		for (const directPath of directLinks) {
			const secondHop = [
				...this.analyzer.getOutgoingLinks(directPath),
				...this.analyzer.getIncomingLinks(directPath),
			];
			for (const hopPath of secondHop) {
				if (hopPath === filePath) continue;
				if (existingLinks.includes(hopPath)) continue;
				if (directLinks.has(hopPath)) continue;

				const proximity = computeProximityWeight(filePath, hopPath, weights);
				const entry = candidates.get(hopPath);
				if (entry) {
					entry.score = Math.max(entry.score, proximity * 0.25);
					if (!entry.reasons.includes('2-hop link neighbor')) {
						entry.reasons.push('2-hop link neighbor');
					}
				} else {
					candidates.set(hopPath, {
						score: proximity * 0.25,
						reasons: ['2-hop link neighbor'],
					});
				}
			}
		}
	}

	private addSharedTagCandidates(
		file: TFile,
		fileTags: Set<string>,
		candidates: Map<string, { score: number; reasons: string[] }>,
		weights: WeightConfig,
		existingLinks: string[]
	): void {
		if (fileTags.size === 0) return;

		const tagIndex = this.analyzer.buildTagIndex();

		// For each of the file's tags, find other files that share it
		const sharedCounts = new Map<string, number>();
		for (const tag of fileTags) {
			const entry = tagIndex.tags.get(tag);
			if (!entry) continue;
			for (const otherPath of entry.files) {
				if (otherPath === file.path) continue;
				if (existingLinks.includes(otherPath)) continue;
				sharedCounts.set(otherPath, (sharedCounts.get(otherPath) || 0) + 1);
			}
		}

		for (const [targetPath, sharedCount] of sharedCounts) {
			if (sharedCount < 2) continue;

			const proximity = computeProximityWeight(file.path, targetPath, weights);
			const tagScore = proximity * (sharedCount * 0.15);

			const entry = candidates.get(targetPath);
			const reason = `shares ${sharedCount} tags`;
			if (entry) {
				entry.score = Math.max(entry.score, tagScore);
				entry.reasons.push(reason);
			} else {
				candidates.set(targetPath, {
					score: tagScore,
					reasons: [reason],
				});
			}
		}
	}

	/**
	 * Merge AI-extracted topic candidates with graph-based candidates.
	 *
	 * Topic relevance is king. Graph/proximity scores act as a small bonus
	 * when a candidate appears in both sources, not as an equal signal.
	 */
	mergeTopicCandidates(
		topicCandidates: InternalLinkCandidate[],
		graphCandidates: InternalLinkCandidate[]
	): InternalLinkCandidate[] {
		const merged = new Map<string, InternalLinkCandidate>();

		// Start with graph candidates (low-weight proximity scores)
		for (const c of graphCandidates) {
			merged.set(c.targetPath, { ...c });
		}

		// Topic candidates dominate — graph proximity is a small bonus
		for (const topic of topicCandidates) {
			const existing = merged.get(topic.targetPath);
			if (existing) {
				// Topical + graph support: topic score + small proximity bonus
				existing.relevanceScore =
					topic.relevanceScore + existing.relevanceScore * 0.2;
				if (!existing.reason.includes(topic.reason)) {
					existing.reason = `${topic.reason}; ${existing.reason}`;
				}
			} else {
				merged.set(topic.targetPath, { ...topic });
			}
		}

		const results = [...merged.values()];
		results.sort((a, b) => b.relevanceScore - a.relevanceScore);
		return results;
	}

	private addProximityCandidates(
		file: TFile,
		candidates: Map<string, { score: number; reasons: string[] }>,
		weights: WeightConfig,
		existingLinks: string[]
	): void {
		// Files in the same folder or sibling folders
		const fileFolder = file.path.substring(0, file.path.lastIndexOf('/'));
		const allFiles = this.app.vault.getMarkdownFiles();

		for (const other of allFiles) {
			if (other.path === file.path) continue;
			if (existingLinks.includes(other.path)) continue;

			const otherFolder = other.path.substring(0, other.path.lastIndexOf('/'));

			// Only consider same folder or sibling folders
			if (fileFolder !== otherFolder) {
				const fileParent = fileFolder.substring(0, fileFolder.lastIndexOf('/'));
				const otherParent = otherFolder.substring(0, otherFolder.lastIndexOf('/'));
				if (fileParent !== otherParent) continue;
			}

			const proximity = computeProximityWeight(file.path, other.path, weights);
			if (proximity < weights.siblingFolder) continue;

			const entry = candidates.get(other.path);
			if (entry) {
				entry.score = Math.max(entry.score, proximity * 0.15);
				if (!entry.reasons.some(r => r.includes('folder'))) {
					entry.reasons.push('nearby folder');
				}
			} else {
				candidates.set(other.path, {
					score: proximity * 0.15,
					reasons: ['nearby folder'],
				});
			}
		}
	}
}
