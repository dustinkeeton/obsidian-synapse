import { App, getAllTags, TFile } from 'obsidian';
import { TagIndex, LinkGraph } from './types';

/**
 * Builds in-memory snapshots of the vault's tag and link topology
 * from Obsidian's MetadataCache. Results are cached and invalidated
 * on the 'resolved' event (when all files have been re-indexed).
 */
export class VaultAnalyzer {
	private tagIndexCache: TagIndex | null = null;
	private linkGraphCache: LinkGraph | null = null;

	constructor(private app: App) {}

	/** Invalidate all caches — call from metadataCache 'resolved' event. */
	invalidate(): void {
		this.tagIndexCache = null;
		this.linkGraphCache = null;
	}

	/**
	 * Build an index of every tag in the vault with occurrence counts
	 * and the file paths that use each tag.
	 */
	buildTagIndex(): TagIndex {
		if (this.tagIndexCache) return this.tagIndexCache;

		const tags = new Map<string, { count: number; files: string[] }>();
		const files = this.app.vault.getMarkdownFiles();

		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			const fileTags = getAllTags(cache);
			if (!fileTags) continue;

			for (const tag of fileTags) {
				const normalized = tag.toLowerCase();
				const entry = tags.get(normalized);
				if (entry) {
					entry.count++;
					if (!entry.files.includes(file.path)) {
						entry.files.push(file.path);
					}
				} else {
					tags.set(normalized, { count: 1, files: [file.path] });
				}
			}
		}

		this.tagIndexCache = { tags };
		return this.tagIndexCache;
	}

	/**
	 * Build a bidirectional link graph from resolvedLinks.
	 */
	buildLinkGraph(): LinkGraph {
		if (this.linkGraphCache) return this.linkGraphCache;

		const outgoing = new Map<string, Set<string>>();
		const incoming = new Map<string, Set<string>>();

		const resolved = this.app.metadataCache.resolvedLinks;
		for (const sourcePath of Object.keys(resolved)) {
			const destinations = resolved[sourcePath];
			if (!outgoing.has(sourcePath)) {
				outgoing.set(sourcePath, new Set());
			}
			for (const destPath of Object.keys(destinations)) {
				outgoing.get(sourcePath)!.add(destPath);

				if (!incoming.has(destPath)) {
					incoming.set(destPath, new Set());
				}
				incoming.get(destPath)!.add(sourcePath);
			}
		}

		this.linkGraphCache = { outgoing, incoming };
		return this.linkGraphCache;
	}

	/** Get existing tags for a specific file (normalized, lowercase). */
	getFileTags(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];
		return (getAllTags(cache) || []).map(t => t.toLowerCase());
	}

	/** Get all files that are directly linked from a given file. */
	getOutgoingLinks(filePath: string): string[] {
		const graph = this.buildLinkGraph();
		const links = graph.outgoing.get(filePath);
		return links ? [...links] : [];
	}

	/** Get all files that link TO a given file. */
	getIncomingLinks(filePath: string): string[] {
		const graph = this.buildLinkGraph();
		const links = graph.incoming.get(filePath);
		return links ? [...links] : [];
	}
}
