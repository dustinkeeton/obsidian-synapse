import { App, TFile } from 'obsidian';
import { SynapseSettings } from '../settings';
import {
	mergeTags, parseFrontmatter, serializeFrontmatter, buildCallout, CALLOUT_TYPES,
	ENRICHMENT_START, ENRICHMENT_END, asStringArray,
} from '../shared';
import { EnrichmentProposal, AcceptedItems } from './types';

/**
 * Applies accepted enrichments to a note non-destructively.
 *
 * - Tags: merged into frontmatter `tags` array (never removed).
 * - Internal links: placed in a "Related Notes" section with markers.
 * - External links: placed in a "References" section with markers.
 * - Frontmatter: keys added or arrays merged. Never overwrites existing values.
 *
 * Marker-based sections enable idempotent updates and surgical undo.
 */
export class EnrichmentApplier {
	constructor(
		private app: App,
		private getSettings: () => SynapseSettings
	) {}

	/**
	 * Apply accepted items from a proposal to the note.
	 */
	async apply(proposal: EnrichmentProposal, accepted: AcceptedItems): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) return;

		const settings = this.getSettings().enrichment;

		// The transform is fully synchronous, so re-derive the enriched content
		// from the FRESH note content inside the atomic process() callback.
		await this.app.vault.process(file, (content) =>
			this.buildEnrichedContent(content, proposal, accepted, settings)
		);
	}

	/** Pure transform: apply accepted enrichments to the note content. */
	private buildEnrichedContent(
		content: string,
		proposal: EnrichmentProposal,
		accepted: AcceptedItems,
		settings: SynapseSettings['enrichment']
	): string {
		const parsed = parseFrontmatter(content);

		// 1. Merge tags into frontmatter
		if (accepted.tags.length > 0) {
			mergeTags(parsed.frontmatter, accepted.tags);
		}

		// 2. Merge frontmatter attributes
		const acceptedFmKeys = new Set(accepted.frontmatter);
		for (const fm of proposal.result.frontmatter) {
			if (!acceptedFmKeys.has(fm.key)) continue;
			if (fm.action === 'merge' && Array.isArray(fm.value)) {
				const raw = parsed.frontmatter[fm.key];
				if (Array.isArray(raw)) {
					// `raw` is an untyped on-disk array; coerce to string[] so the
					// merge/dedup is type-safe rather than spreading `any`.
					const existing = asStringArray(raw);
					parsed.frontmatter[fm.key] = [
						...existing,
						...fm.value.filter(v => !existing.includes(v)),
					];
				} else {
					parsed.frontmatter[fm.key] = fm.value;
				}
			} else {
				// Only add if key doesn't already exist
				if (!(fm.key in parsed.frontmatter)) {
					parsed.frontmatter[fm.key] = fm.value;
				}
			}
		}

		// 3. Build body with enrichment sections
		let body = parsed.body;

		// Remove existing enrichment sections (idempotent update)
		body = this.removeEnrichmentSections(body);

		// Build Related Notes section
		const acceptedLinkPaths = new Set(accepted.internalLinks);
		const internalLinks = proposal.result.internalLinks.filter(l =>
			acceptedLinkPaths.has(l.targetPath)
		);

		if (internalLinks.length > 0) {
			const linksSection = this.buildLinksSection(
				internalLinks,
				settings.relatedNotesHeading
			);
			body = body.trimEnd() + '\n\n' + linksSection;
		}

		// Build References section
		const acceptedRefUrls = new Set(accepted.externalLinks);
		const externalLinks = proposal.result.externalLinks.filter(l =>
			acceptedRefUrls.has(l.url)
		);

		if (externalLinks.length > 0) {
			const refsSection = this.buildRefsSection(
				externalLinks,
				settings.referencesHeading
			);
			body = body.trimEnd() + '\n\n' + refsSection;
		}

		// Serialize and return the enriched content
		return serializeFrontmatter(parsed.frontmatter, body);
	}

	/**
	 * Undo enrichments by removing accepted items.
	 */
	async undo(proposal: EnrichmentProposal): Promise<void> {
		if (!proposal.acceptedItems) return;

		const file = this.app.vault.getAbstractFileByPath(proposal.sourceNotePath);
		if (!(file instanceof TFile)) return;

		// The transform is fully synchronous, so re-derive the reverted content
		// from the FRESH note content inside the atomic process() callback.
		await this.app.vault.process(file, (content) =>
			this.buildRevertedContent(content, proposal)
		);
	}

	/** Pure transform: remove accepted enrichments from the note content. */
	private buildRevertedContent(
		content: string,
		proposal: EnrichmentProposal
	): string {
		if (!proposal.acceptedItems) return content;
		const parsed = parseFrontmatter(content);

		// Remove accepted tags
		if (proposal.acceptedItems.tags.length > 0) {
			const toRemove = new Set(
				proposal.acceptedItems.tags.map(t =>
					t.startsWith('#') ? t.slice(1) : t
				)
			);
			const existing = parsed.frontmatter.tags;
			if (Array.isArray(existing)) {
				parsed.frontmatter.tags = existing.filter(
					t => !toRemove.has(String(t))
				);
			}
		}

		// Remove accepted frontmatter keys
		for (const key of proposal.acceptedItems.frontmatter) {
			delete parsed.frontmatter[key];
		}

		// Remove enrichment sections from body
		let body = parsed.body;
		body = this.removeEnrichmentSections(body);

		return serializeFrontmatter(parsed.frontmatter, body);
	}

	private buildLinksSection(
		links: { targetPath: string; displayText: string; reason: string }[],
		heading: string
	): string {
		const bodyLines: string[] = [];
		for (const link of links) {
			// Sanitize display text and reason to prevent wikilink/markdown injection
			const safeDisplay = link.displayText.replace(/[[\]|]/g, '');
			const safeReason = link.reason.replace(/[[\]()]/g, '');
			bodyLines.push(`- [[${safeDisplay}]] — ${safeReason}`);
		}
		return buildCallout(
			CALLOUT_TYPES.enrichment,
			heading,
			bodyLines.join('\n')
		).trim();
	}

	private buildRefsSection(
		refs: { url: string; title: string; reason: string }[],
		heading: string
	): string {
		const bodyLines: string[] = [];
		for (const ref of refs) {
			// Sanitize AI-generated strings to prevent markdown injection
			const safeTitle = ref.title.replace(/[[\]()]/g, '');
			const safeReason = ref.reason.replace(/[[\]()]/g, '');
			// Validate URL scheme before writing to note
			let safeUrl = ref.url;
			try {
				const parsed = new URL(ref.url);
				if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
					continue; // Skip non-HTTP URLs
				}
			} catch {
				continue; // Skip invalid URLs
			}
			bodyLines.push(`- [${safeTitle}](${safeUrl}) — ${safeReason}`);
		}
		return buildCallout(
			CALLOUT_TYPES.enrichment,
			heading,
			bodyLines.join('\n')
		).trim();
	}

	private removeEnrichmentSections(body: string): string {
		let result = body;

		// Remove legacy comment-marker sections
		const startMarker = ENRICHMENT_START;
		const endMarker = ENRICHMENT_END;
		while (true) {
			const startIdx = result.indexOf(startMarker);
			if (startIdx === -1) break;
			const endIdx = result.indexOf(endMarker, startIdx);
			if (endIdx === -1) break;

			const before = result.slice(0, startIdx).trimEnd();
			const after = result.slice(endIdx + endMarker.length);
			result = before + after;
		}

		// Remove callout-format enrichment sections
		const calloutPattern = new RegExp(
			`^> \\[!${CALLOUT_TYPES.enrichment}\\][^\\n]*(?:\\n>[^\\n]*)*\\n?`,
			'gm'
		);
		result = result.replace(calloutPattern, '').replace(/\n{3,}/g, '\n\n');

		return result;
	}
}
