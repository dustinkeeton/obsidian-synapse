import { App, getAllTags, TFile } from 'obsidian';
import type { SynapseSettings } from '../settings';
import { getIncludedMarkdownFiles } from '../shared';
import { FrontmatterValueIndex, TagIndex, LinkGraph } from './types';

/**
 * Builds in-memory snapshots of the vault's tag and link topology
 * from Obsidian's MetadataCache. Results are cached and invalidated
 * on the 'resolved' event (when all files have been re-indexed).
 */
export class VaultAnalyzer {
	private tagIndexCache: TagIndex | null = null;
	private linkGraphCache: LinkGraph | null = null;
	private frontmatterValueCache: FrontmatterValueIndex = new Map();

	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	/** Invalidate all caches — call from metadataCache 'resolved' event. */
	invalidate(): void {
		this.tagIndexCache = null;
		this.linkGraphCache = null;
		this.frontmatterValueCache = new Map();
	}

	/** De-duplicated values per key across included notes, most frequent first; scalars and arrays both count. */
	buildFrontmatterValueIndex(keys: readonly string[]): FrontmatterValueIndex {
		const missing = keys.filter(key => !this.frontmatterValueCache.has(key));
		if (missing.length > 0) {
			const counts = new Map<string, Map<string, number>>(missing.map(key => [key, new Map()]));
			for (const file of getIncludedMarkdownFiles(this.app, 'enrichment', this.getSettings())) {
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
				if (!frontmatter) continue;
				for (const key of missing) {
					const perKey = counts.get(key)!;
					for (const value of new Set(normalizeFrontmatterValues(frontmatter[key]))) {
						perKey.set(value, (perKey.get(value) ?? 0) + 1);
					}
				}
			}
			for (const [key, perKey] of counts) {
				this.frontmatterValueCache.set(
					key,
					[...perKey.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value)
				);
			}
		}
		return new Map(keys.map(key => [key, this.frontmatterValueCache.get(key) ?? []]));
	}

	/**
	 * Build an index of every tag in the vault with occurrence counts
	 * and the file paths that use each tag.
	 */
	buildTagIndex(): TagIndex {
		if (this.tagIndexCache) return this.tagIndexCache;

		const tags = new Map<string, { count: number; files: string[] }>();
		const files = getIncludedMarkdownFiles(this.app, 'enrichment', this.getSettings());

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

function normalizeFrontmatterValues(raw: unknown): string[] {
	const items: unknown[] = Array.isArray(raw) ? raw : [raw];
	const values: string[] = [];
	for (const item of items) {
		if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') continue;
		const value = String(item).trim();
		if (value !== '') values.push(value);
	}
	return values;
}
