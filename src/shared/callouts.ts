/**
 * Unified callout registry for all AI-generated content.
 *
 * Every AI content type uses an Obsidian callout (`> [!synapse-type]`)
 * with a distinct type identifier. This module provides the registry of
 * type names and a utility to build well-formed callout blocks.
 */

export const CALLOUT_TYPES = {
	summary: 'synapse-summary',
	transcription: 'synapse-transcription',
	enrichment: 'synapse-enrichment',
	elaboration: 'synapse-elaboration',
	deepDive: 'synapse-deep-dive',
	nav: 'synapse-nav',
	ocr: 'synapse-ocr',
} as const;

export type CalloutType = (typeof CALLOUT_TYPES)[keyof typeof CALLOUT_TYPES];

/**
 * Legacy comment-based enrichment section markers.
 *
 * Used by the enrichment module to wrap injected sections and by the
 * summarize module to skip enrichment content during note scanning.
 * Placed in shared/ because they are referenced cross-module.
 */
export const ENRICHMENT_START = '%% synapse-enrichment-start %%';
export const ENRICHMENT_END = '%% synapse-enrichment-end %%';

/**
 * Build an Obsidian callout block.
 *
 * @param type   - One of the CALLOUT_TYPES values (e.g. 'synapse-summary')
 * @param title  - Title displayed on the callout header line
 * @param body   - Content of the callout (may be multi-line)
 * @param collapsed - If true, the callout renders collapsed by default (adds `-` suffix)
 * @returns A complete callout block string with leading/trailing blank lines
 */
export function buildCallout(
	type: CalloutType,
	title: string,
	body: string,
	collapsed = false
): string {
	const collapseMarker = collapsed ? '-' : '';
	const header = `> [!${type}]${collapseMarker} ${title}`;
	const bodyLines = body.split('\n').map(line => `> ${line}`);
	return ['', header, ...bodyLines, ''].join('\n');
}
