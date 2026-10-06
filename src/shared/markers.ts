// `<!-- synapse:<kind> key="value" -->` … `<!-- /synapse:<kind> -->`: idempotence marker for plain-Markdown generated sections (#550).
// HTML comments (not `%% %%`) because every Markdown renderer hides them.

export const MARKER_KINDS = {
	summary: 'summary',
	elaboration: 'elaboration',
} as const;

export type MarkerKind = (typeof MARKER_KINDS)[keyof typeof MARKER_KINDS];

export type MarkerAttrs = Record<string, string>;

export interface MarkerOpener {
	kind: string;
	attrs: MarkerAttrs;
}

/** A matched opener/closer pair; `start`/`end` are the opener and closer line indexes. */
export interface MarkerRegion extends MarkerOpener {
	start: number;
	end: number;
	/** Lines strictly between opener and closer. */
	body: string;
}

const OPENER_RE = /^\s*<!-- synapse:([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9-]*="[^"]*")*)\s*-->\s*$/;
const CLOSER_RE = /^\s*<!-- \/synapse:([a-z][a-z0-9-]*) -->\s*$/;
const ATTR_RE = /([a-z][a-z0-9-]*)="([^"]*)"/g;
const ENTITY_RE = /&(quot|#45|amp);/g;
const ENTITIES: Record<string, string> = { quot: '"', '#45': '-', amp: '&' };
// A body line that parses as one of our markers would truncate or nest the region.
const BODY_MARKER_RE = /<!--(\s*\/?)synapse:/gi;

/** `--` and `"` are illegal inside an HTML comment attribute; newlines never belong in one. */
export function encodeMarkerAttr(value: string): string {
	return value
		.replace(/[\r\n]+/g, ' ')
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/--/g, '-&#45;');
}

export function decodeMarkerAttr(value: string): string {
	return value.replace(ENTITY_RE, (_, name: string) => ENTITIES[name]);
}

export function markerOpener(kind: MarkerKind, attrs: MarkerAttrs = {}): string {
	const encoded = Object.entries(attrs)
		.filter(([, v]) => v !== '')
		.map(([k, v]) => ` ${k}="${encodeMarkerAttr(v)}"`)
		.join('');
	return `<!-- synapse:${kind}${encoded} -->`;
}

export function markerCloser(kind: MarkerKind): string {
	return `<!-- /synapse:${kind} -->`;
}

/** Wrap `body` in a marker pair with a blank line on each side (same outer shape as `buildCallout`). */
export function buildMarkerSection(kind: MarkerKind, body: string, attrs: MarkerAttrs = {}): string {
	const safeBody = body.replace(BODY_MARKER_RE, '<!--$1synapse&#58;');
	return ['', markerOpener(kind, attrs), ...safeBody.split('\n'), markerCloser(kind), ''].join('\n');
}

export function parseMarkerOpener(line: string): MarkerOpener | null {
	const match = line.match(OPENER_RE);
	if (!match) return null;
	const attrs: MarkerAttrs = {};
	for (const attr of match[2].matchAll(ATTR_RE)) attrs[attr[1]] = decodeMarkerAttr(attr[2]);
	return { kind: match[1], attrs };
}

export function parseMarkerCloser(line: string): string | null {
	const match = line.match(CLOSER_RE);
	return match ? match[1] : null;
}

/**
 * Every matched region in `lines`, in opener order; `kind` restricts the result.
 * A closer pairs with the nearest open opener of its kind; unmatched lines are ignored.
 */
export function findMarkerRegions(lines: string[], kind?: string): MarkerRegion[] {
	const open: Array<MarkerOpener & { start: number }> = [];
	const regions: MarkerRegion[] = [];
	for (let i = 0; i < lines.length; i++) {
		const opener = parseMarkerOpener(lines[i]);
		if (opener) {
			open.push({ ...opener, start: i });
			continue;
		}
		const closing = parseMarkerCloser(lines[i]);
		if (closing === null) continue;
		for (let k = open.length - 1; k >= 0; k--) {
			if (open[k].kind !== closing) continue;
			const [{ start, ...head }] = open.splice(k, 1);
			regions.push({ ...head, start, end: i, body: lines.slice(start + 1, i).join('\n') });
			break;
		}
	}
	regions.sort((a, b) => a.start - b.start);
	return kind ? regions.filter((r) => r.kind === kind) : regions;
}

/** Line indexes covered by any marker region (opener and closer included). */
export function markerCoveredLines(lines: string[], kind?: string): Set<number> {
	const covered = new Set<number>();
	for (const region of findMarkerRegions(lines, kind)) {
		for (let i = region.start; i <= region.end; i++) covered.add(i);
	}
	return covered;
}

/** True when `region.attrs` carries every entry of `wanted`. */
export function markerAttrsMatch(region: MarkerOpener, wanted: MarkerAttrs | undefined): boolean {
	if (!wanted) return true;
	return Object.entries(wanted).every(([k, v]) => region.attrs[k] === v);
}
