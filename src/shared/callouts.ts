/**
 * Unified callout registry for all AI-generated content.
 *
 * Every AI content type is written as a native Obsidian callout whose type
 * slot carries a base (`summary`, `info`, `quote`, `note`) and whose metadata
 * slot carries the Synapse identity: `> [!quote|synapse-transcription]`.
 * Readers must also accept the legacy bare form `> [!synapse-transcription]`.
 */

export const CALLOUT_TYPES = {
	summary: 'synapse-summary',
	transcription: 'synapse-transcription',
	lyrics: 'synapse-lyrics',
	verse: 'synapse-verse',
	chorus: 'synapse-chorus',
	enrichment: 'synapse-enrichment',
	elaboration: 'synapse-elaboration',
	deepDive: 'synapse-deep-dive',
	nav: 'synapse-nav',
	ocr: 'synapse-ocr',
	illustrate: 'synapse-illustrate',
} as const;

export type CalloutType = (typeof CALLOUT_TYPES)[keyof typeof CALLOUT_TYPES];

/** Native Obsidian callout types a Synapse callout may inherit theme styling from. */
export type CalloutBase = 'note' | 'summary' | 'info' | 'quote';

/** Base callout each Synapse identity is written as; `note` is Obsidian's own fallback for unknown types. */
export const CALLOUT_BASES: Record<CalloutType, CalloutBase> = {
	'synapse-summary': 'summary',
	'synapse-transcription': 'quote',
	'synapse-lyrics': 'quote',
	'synapse-verse': 'note',
	'synapse-chorus': 'note',
	'synapse-enrichment': 'info',
	'synapse-elaboration': 'note',
	'synapse-deep-dive': 'note',
	'synapse-nav': 'note',
	'synapse-ocr': 'quote',
	'synapse-illustrate': 'note',
};

/**
 * Choose the callout type and header verb for a finished transcription based on
 * whether a content schema reformatted it. Lyric reformatting (#234) writes a
 * distinct `synapse-lyrics` callout — which the summarize note-scanner does not
 * match — so reformatted song lyrics are never re-condensed into a summary.
 */
export function calloutForTranscriptionResult(
	result: { reformatted?: boolean; schemaId?: string }
): { type: CalloutType; verb: string } {
	if (result.schemaId === 'lyrics') {
		return { type: CALLOUT_TYPES.lyrics, verb: 'Lyrics of' };
	}
	return { type: CALLOUT_TYPES.transcription, verb: 'Transcription of' };
}

/**
 * Legacy comment-based enrichment section markers.
 *
 * Used by the enrichment module to wrap injected sections and by the
 * summarize module to skip enrichment content during note scanning.
 * Placed in shared/ because they are referenced cross-module.
 */
export const ENRICHMENT_START = '%% synapse-enrichment-start %%';
export const ENRICHMENT_END = '%% synapse-enrichment-end %%';

/** The `[!…]` token Obsidian reads for `type`: `summary|synapse-summary`. */
export function calloutHeaderToken(type: CalloutType): string {
	return `${CALLOUT_BASES[type]}|${type}`;
}

/** The header line of a `type` callout: `> [!<base>|<type>]<-> <title>`. */
export function calloutHeaderLine(type: CalloutType, title: string, collapsed = false): string {
	return `> [!${calloutHeaderToken(type)}]${collapsed ? '-' : ''} ${title}`;
}

/** Synapse identity of a header's `[!…]` content: the metadata after `|` when present, else the bare type (legacy form). */
export function calloutIdentity(headerContent: string): string {
	const pipe = headerContent.indexOf('|');
	return (pipe === -1 ? headerContent : headerContent.slice(pipe + 1)).trim().toLowerCase();
}

/** Regex source matching the `[!…]` token of a `type` callout in either spelling; callers add anchors and the fold marker. */
export function calloutHeaderSource(type: CalloutType): string {
	return `\\[!(?:[^\\]|]*\\|)?${type}\\]`;
}

const HEADER_LINE_RE = /^[\s>]*\[!([^\]]+)\][-+]?\s*(.*)$/;

/** Parse a `> [!…] title` line into its Synapse identity and title; null when the line opens no callout. */
export function parseCalloutHeader(line: string): { identity: string; title: string } | null {
	const match = line.match(HEADER_LINE_RE);
	return match ? { identity: calloutIdentity(match[1]), title: match[2].trim() } : null;
}

/** True when `line` is the header of a `type` callout, in the `[!<base>|type]` or legacy `[!type]` spelling. */
export function isCalloutHeader(line: string, type: CalloutType): boolean {
	return parseCalloutHeader(line)?.identity === type;
}

/** True when any line of `content` opens a `type` callout. */
export function hasCallout(content: string, type: CalloutType): boolean {
	return content.split('\n').some((line) => isCalloutHeader(line, type));
}

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
	const header = calloutHeaderLine(type, title, collapsed);
	const bodyLines = body.split('\n').map(line => `> ${line}`);
	return ['', header, ...bodyLines, ''].join('\n');
}
