/**
 * Unified callout registry for all AI-generated content.
 *
 * Every AI content type uses an Obsidian callout (`> [!auto-notes-type]`)
 * with a distinct type identifier. This module provides the registry of
 * type names and a utility to build well-formed callout blocks.
 */

export const CALLOUT_TYPES = {
	summary: 'auto-notes-summary',
	transcription: 'auto-notes-transcription',
	enrichment: 'auto-notes-enrichment',
	elaboration: 'auto-notes-elaboration',
	deepDive: 'auto-notes-deep-dive',
	nav: 'auto-notes-nav',
} as const;

export type CalloutType = (typeof CALLOUT_TYPES)[keyof typeof CALLOUT_TYPES];

/**
 * Build an Obsidian callout block.
 *
 * @param type   - One of the CALLOUT_TYPES values (e.g. 'auto-notes-summary')
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
