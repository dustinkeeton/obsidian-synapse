import { App, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import { wordCount, isPathExcluded, matchesExcludeTag } from '../shared';
import { DetectionReason, DetectionResult } from './types';

export class PlaceholderDetector {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	async detect(file: TFile): Promise<DetectionResult | null> {
		const settings = this.getSettings().elaboration;
		const content = await this.app.vault.read(file);
		const reasons: DetectionReason[] = [];

		if (this.isExcluded(file)) return null;

		// Strip frontmatter for analysis
		const body = this.stripFrontmatter(content);

		if (settings.detection.detectTodoMarkers) {
			const markers = this.findTodoMarkers(body);
			if (markers.length > 0) {
				reasons.push({ type: 'todo-marker', markers });
			}
		}

		if (settings.detection.detectEmptySections) {
			const emptySection = this.findEmptySection(body);
			if (emptySection) {
				reasons.push({ type: 'empty-section', heading: emptySection });
			}
		}

		const wc = wordCount(body);
		if (wc < settings.detection.minWordThreshold) {
			reasons.push({ type: 'short-note', wordCount: wc });
		}

		if (settings.detection.detectSparseLinks) {
			const linkedFrom = this.findInboundLinks(file);
			if (linkedFrom.length > 0 && wc < settings.detection.minWordThreshold) {
				reasons.push({ type: 'sparse-link', linkedFrom });
			}
		}

		if (reasons.length === 0) return null;

		return { notePath: file.path, reasons };
	}

	private isExcluded(file: TFile): boolean {
		const settings = this.getSettings();
		return (
			isPathExcluded(file.path, 'elaboration', settings) ||
			matchesExcludeTag(file, settings.elaboration.detection.excludeTags, this.app.metadataCache)
		);
	}

	private stripFrontmatter(content: string): string {
		const match = content.match(/^---\n[\s\S]*?\n---\n?/);
		return match ? content.slice(match[0].length) : content;
	}

	private findTodoMarkers(body: string): string[] {
		const markers: string[] = [];
		const patterns = [/\bTODO\b/g, /\bTBD\b/g, /\bFIXME\b/g, /\bPLACEHOLDER\b/gi];
		for (const pattern of patterns) {
			const matches = body.match(pattern);
			if (matches) {
				markers.push(...matches);
			}
		}
		return [...new Set(markers)];
	}

	private findEmptySection(body: string): string | null {
		const lines = body.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const headingMatch = lines[i].match(/^(#{1,6})\s+(.+)/);
			if (!headingMatch) continue;

			const headingLevel = headingMatch[1].length;
			const headingText = headingMatch[2];
			let hasContent = false;

			for (let j = i + 1; j < lines.length; j++) {
				const nextHeading = lines[j].match(/^(#{1,6})\s/);
				if (nextHeading && nextHeading[1].length <= headingLevel) break;
				if (lines[j].trim().length > 0) {
					hasContent = true;
					break;
				}
			}

			if (!hasContent) return headingText;
		}
		return null;
	}

	private findInboundLinks(file: TFile): string[] {
		const links: string[] = [];
		const allFiles = this.app.vault.getMarkdownFiles();
		for (const other of allFiles) {
			if (other.path === file.path) continue;
			const cache = this.app.metadataCache.getFileCache(other);
			if (cache?.links) {
				for (const link of cache.links) {
					const resolved = this.app.metadataCache.getFirstLinkpathDest(
						link.link,
						other.path
					);
					if (resolved?.path === file.path) {
						links.push(other.path);
						break;
					}
				}
			}
		}
		return links;
	}
}
