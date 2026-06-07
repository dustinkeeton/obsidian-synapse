import { App, TFolder } from 'obsidian';
import { ContentAnalysis, DirectoryScore, OrganizeAction } from './types';
import { canonicalKey, isFuzzyMatch } from './folder-normalize';

/**
 * Matches notes to existing directories by semantic relevance.
 * Heavily weights existing directories to minimize new directory creation.
 */
export class DirectoryMatcher {
	constructor(private app: App) {}

	/**
	 * Score all existing directories against a note's content analysis.
	 * Returns scores sorted by relevance (highest first).
	 */
	scoreDirectories(analysis: ContentAnalysis): DirectoryScore[] {
		const directories = this.collectDirectories();
		const noteDir = this.getParentPath(analysis.notePath);

		const scores: DirectoryScore[] = [];

		for (const dir of directories) {
			const score = this.scoreDirectory(dir, analysis, noteDir);
			if (score > 0) {
				scores.push({
					directoryPath: dir,
					score,
					reason: this.buildReason(dir, analysis),
				});
			}
		}

		return scores.sort((a, b) => b.score - a.score);
	}

	/**
	 * Determine the best action for a note based on its content analysis.
	 * Returns a move action if an existing directory is a good fit,
	 * or a propose-new-directory action if none are suitable.
	 *
	 * @param minScoreThreshold - Minimum score for a directory to be considered
	 *   a valid match (0-1). Below this, a new directory will be proposed.
	 *   Default 0.6 — requires a strong topical match.
	 * @param confidenceThreshold - Minimum confidence of the top topic required
	 *   to propose a new directory (0-1). Default 0.9 — only highly confident
	 *   topics justify new folder creation.
	 */
	determineAction(
		analysis: ContentAnalysis,
		minScoreThreshold = 0.6,
		confidenceThreshold = 0.9
	): OrganizeAction {
		const scores = this.scoreDirectories(analysis);
		const noteDir = this.getParentPath(analysis.notePath);

		// Filter out the note's current directory (no-op move)
		const candidates = scores.filter(s => s.directoryPath !== noteDir);

		if (candidates.length > 0 && candidates[0].score >= minScoreThreshold) {
			return {
				type: 'move',
				targetDirectory: candidates[0].directoryPath,
			};
		}

		// Propose a new directory based on the top topic, but only when
		// the AI is highly confident about the note's primary topic.
		const topTopic = analysis.topics[0];
		if (topTopic && topTopic.confidence >= confidenceThreshold) {
			const newDir = this.buildDirectoryPath(topTopic.label);
			return {
				type: 'propose-new-directory',
				targetDirectory: newDir,
				reasoning: `Note is about "${topTopic.label}" (confidence: ${(topTopic.confidence * 100).toFixed(0)}%). No existing directory matches well.`,
			};
		}

		// No topics or confidence too low; keep in place
		return {
			type: 'move',
			targetDirectory: noteDir,
		};
	}

	/**
	 * Score a single directory against a note's content analysis.
	 */
	scoreDirectory(
		dirPath: string,
		analysis: ContentAnalysis,
		noteDir: string
	): number {
		let score = 0;
		const dirKey = canonicalKey(this.getDirectoryName(dirPath));
		const partKeys = dirPath
			.split('/')
			.filter(Boolean)
			.map(p => canonicalKey(p))
			.filter(Boolean);

		// 1. Topic match — strongest signal. Compared on canonical (singular,
		// punctuation-normalized) keys so "model" coalesces with "models" and
		// "machine learning" with "machine-learning".
		for (const topic of analysis.topics) {
			const topicKey = canonicalKey(topic.label);
			if (!topicKey) continue;

			// Exact canonical match with directory name
			if (dirKey && dirKey === topicKey) {
				score += 0.6 * topic.confidence;
			}
			// Directory name contains the topic (or vice versa)
			else if (dirKey && (dirKey.includes(topicKey) || topicKey.includes(dirKey))) {
				score += 0.4 * topic.confidence;
			}
			// Any path segment matches
			else if (partKeys.some(p => p === topicKey || p.includes(topicKey) || topicKey.includes(p))) {
				score += 0.25 * topic.confidence;
			}
			// Conservative near-match (typo tolerance). Weak tier — cannot reach
			// the move threshold on its own.
			else if (dirKey && isFuzzyMatch(topicKey, dirKey)) {
				score += 0.4 * topic.confidence;
			}
		}

		// 2. Tag match — directories that share tag names
		for (const tag of analysis.tags) {
			const tagKey = canonicalKey(tag.replace(/^#/, ''));
			if (tagKey && dirKey && (dirKey === tagKey || dirKey.includes(tagKey))) {
				score += 0.15;
			}
		}

		// 3. Link proximity — notes linked from this note live in this directory
		for (const linkPath of analysis.links) {
			const linkDir = this.getParentPath(linkPath);
			if (linkDir === dirPath) {
				score += 0.1;
			}
		}

		// 4. Penalty for the note's current directory (prefer actual moves)
		if (dirPath === noteDir) {
			score *= 0.5;
		}

		return Math.min(1, score);
	}

	/**
	 * Collect all directory paths in the vault.
	 */
	collectDirectories(): string[] {
		const root = this.app.vault.getRoot();
		const dirs: string[] = [];
		this.walkFolders(root, dirs);
		return dirs;
	}

	/**
	 * Build a human-readable reason for why a directory was scored.
	 */
	private buildReason(dirPath: string, analysis: ContentAnalysis): string {
		const dirKey = canonicalKey(this.getDirectoryName(dirPath));
		const reasons: string[] = [];

		for (const topic of analysis.topics) {
			const topicKey = canonicalKey(topic.label);
			if (!topicKey || !dirKey) continue;
			if (dirKey === topicKey) {
				reasons.push(`exact topic match: "${topic.label}"`);
			} else if (dirKey.includes(topicKey) || topicKey.includes(dirKey)) {
				reasons.push(`partial topic match: "${topic.label}"`);
			} else if (isFuzzyMatch(topicKey, dirKey)) {
				reasons.push(`similar topic match: "${topic.label}"`);
			}
		}

		for (const tag of analysis.tags) {
			const tagKey = canonicalKey(tag.replace(/^#/, ''));
			if (tagKey && dirKey && (dirKey === tagKey || dirKey.includes(tagKey))) {
				reasons.push(`tag match: ${tag}`);
			}
		}

		const linkedCount = analysis.links.filter(
			l => this.getParentPath(l) === dirPath
		).length;
		if (linkedCount > 0) {
			reasons.push(`${linkedCount} linked note(s) in directory`);
		}

		return reasons.length > 0 ? reasons.join(', ') : 'general relevance';
	}

	private getParentPath(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash === -1 ? '' : filePath.slice(0, lastSlash);
	}

	private walkFolders(folder: TFolder, result: string[]): void {
		// Skip root — notes in root don't need the empty string path
		if (!folder.isRoot()) {
			result.push(folder.path);
		}
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				this.walkFolders(child, result);
			}
		}
	}

	private getDirectoryName(dirPath: string): string {
		const parts = dirPath.split('/').filter(Boolean);
		return parts.length > 0 ? parts[parts.length - 1] : '';
	}

	/**
	 * Build a clean directory path from a topic label.
	 * Converts to lowercase kebab-case and singularizes each word so that
	 * equivalent topics ("model" / "models") yield an identical folder name.
	 */
	buildDirectoryPath(topicLabel: string): string {
		return canonicalKey(topicLabel).slice(0, 50);
	}
}
