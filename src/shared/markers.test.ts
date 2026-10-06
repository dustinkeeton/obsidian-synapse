import { describe, it, expect } from 'vitest';
import {
	MARKER_KINDS,
	buildMarkerSection,
	markerOpener,
	markerCloser,
	parseMarkerOpener,
	parseMarkerCloser,
	findMarkerRegions,
	markerCoveredLines,
	markerAttrsMatch,
	encodeMarkerAttr,
	decodeMarkerAttr,
} from './markers';

describe('markerOpener / markerCloser', () => {
	it('emits a bare opener when there are no attributes', () => {
		expect(markerOpener(MARKER_KINDS.elaboration)).toBe('<!-- synapse:elaboration -->');
		expect(markerCloser(MARKER_KINDS.elaboration)).toBe('<!-- /synapse:elaboration -->');
	});

	it('serialises attributes and drops empty ones', () => {
		expect(markerOpener(MARKER_KINDS.summary, { source: 'https://a.example/x', title: '' }))
			.toBe('<!-- synapse:summary source="https://a.example/x" -->');
	});
});

describe('attribute encoding', () => {
	it('keeps `--` and `"` out of the comment and round-trips them', () => {
		const raw = 'https://ex.com/a--b?q="x"&y=1';
		const encoded = encodeMarkerAttr(raw);
		expect(encoded).not.toContain('--');
		expect(encoded).not.toContain('"');
		expect(decodeMarkerAttr(encoded)).toBe(raw);
		expect(parseMarkerOpener(markerOpener(MARKER_KINDS.summary, { source: raw }))?.attrs.source).toBe(raw);
	});

	it('round-trips values that already contain entities and odd dash runs', () => {
		for (const raw of ['a&quot;b', 'x&#45;y', '---', '----', 'a-b-c']) {
			expect(decodeMarkerAttr(encodeMarkerAttr(raw))).toBe(raw);
		}
	});

	it('flattens newlines so the comment stays on one line', () => {
		expect(encodeMarkerAttr('a\nb\r\nc')).toBe('a b c');
	});
});

describe('buildMarkerSection', () => {
	it('wraps the body with a blank line on each side', () => {
		const out = buildMarkerSection(MARKER_KINDS.summary, '## Summary of X\n\nBody', { source: 'X' });
		expect(out.split('\n')).toEqual([
			'',
			'<!-- synapse:summary source="X" -->',
			'## Summary of X',
			'',
			'Body',
			'<!-- /synapse:summary -->',
			'',
		]);
	});

	it('neutralises marker-looking lines inside the body so the region cannot be closed early', () => {
		const out = buildMarkerSection(MARKER_KINDS.elaboration, 'text\n<!-- /synapse:elaboration -->\n<!-- synapse:summary -->\nmore');
		const regions = findMarkerRegions(out.split('\n'));
		expect(regions).toHaveLength(1);
		expect(regions[0].body).toContain('more');
	});
});

describe('parseMarkerOpener / parseMarkerCloser', () => {
	it('parses kind and attributes', () => {
		expect(parseMarkerOpener('<!-- synapse:summary source="https://a.example" title="T" -->'))
			.toEqual({ kind: 'summary', attrs: { source: 'https://a.example', title: 'T' } });
		expect(parseMarkerOpener('<!-- synapse:elaboration -->')).toEqual({ kind: 'elaboration', attrs: {} });
		expect(parseMarkerCloser('<!-- /synapse:summary -->')).toBe('summary');
	});

	it('rejects ordinary comments, callouts, and closers in the opener slot', () => {
		expect(parseMarkerOpener('<!-- a note to self -->')).toBeNull();
		expect(parseMarkerOpener('> [!synapse-summary] Summary of X')).toBeNull();
		expect(parseMarkerOpener('<!-- /synapse:summary -->')).toBeNull();
		expect(parseMarkerCloser('<!-- synapse:summary -->')).toBeNull();
		expect(parseMarkerOpener('text <!-- synapse:summary -->')).toBeNull();
	});
});

describe('findMarkerRegions', () => {
	const NOTE = [
		'---',
		'title: X',
		'---',
		'Intro.',
		'',
		'<!-- synapse:summary source="https://a" -->',
		'## Summary of https://a',
		'',
		'Summary body.',
		'<!-- /synapse:summary -->',
		'',
		'> [!synapse-summary] Summary of https://legacy',
		'> Legacy body.',
		'',
		'<!-- synapse:elaboration -->',
		'*Elaboration by Synapse*',
		'',
		'<!-- synapse:summary source="https://b" -->',
		'## Summary of https://b',
		'Nested body.',
		'<!-- /synapse:summary -->',
		'',
		'Elaborated prose.',
		'<!-- /synapse:elaboration -->',
		'',
		'<!-- /synapse:summary -->',
		'Outro.',
	];

	it('finds regions after frontmatter with raw line indexes and the inner body', () => {
		const regions = findMarkerRegions(NOTE, MARKER_KINDS.summary);
		expect(regions.map((r) => [r.start, r.end, r.attrs.source])).toEqual([
			[5, 9, 'https://a'],
			[17, 20, 'https://b'],
		]);
		expect(regions[0].body).toBe('## Summary of https://a\n\nSummary body.');
	});

	it('pairs a nested region with its own kind and keeps the outer region intact', () => {
		const all = findMarkerRegions(NOTE);
		expect(all.map((r) => [r.kind, r.start, r.end])).toEqual([
			['summary', 5, 9],
			['elaboration', 14, 23],
			['summary', 17, 20],
		]);
		expect(all[1].body).toContain('Elaborated prose.');
		expect(all[1].body).toContain('Nested body.');
	});

	it('ignores a stray closer and an unclosed opener', () => {
		expect(findMarkerRegions(['<!-- /synapse:summary -->', 'x'])).toEqual([]);
		expect(findMarkerRegions(['<!-- synapse:summary -->', 'x'])).toEqual([]);
		expect(findMarkerRegions(['<!-- synapse:summary -->', '<!-- /synapse:elaboration -->'])).toEqual([]);
	});

	it('leaves legacy callouts alone', () => {
		const legacyOnly = NOTE.slice(11, 13);
		expect(findMarkerRegions(legacyOnly)).toEqual([]);
	});

	it('handles adjacent regions', () => {
		const lines = [
			'<!-- synapse:summary source="a" -->', 'A', '<!-- /synapse:summary -->',
			'<!-- synapse:summary source="b" -->', 'B', '<!-- /synapse:summary -->',
		];
		expect(findMarkerRegions(lines).map((r) => [r.start, r.end, r.body])).toEqual([[0, 2, 'A'], [3, 5, 'B']]);
	});

	it('reports covered lines inclusive of both markers', () => {
		expect([...markerCoveredLines(NOTE, MARKER_KINDS.summary)].sort((a, b) => a - b))
			.toEqual([5, 6, 7, 8, 9, 17, 18, 19, 20]);
		expect(markerCoveredLines(NOTE).has(22)).toBe(true);
		expect(markerCoveredLines(NOTE).has(26)).toBe(false);
	});
});

describe('markerAttrsMatch', () => {
	const region = { kind: 'summary', attrs: { source: 'a', title: 't' } };
	it('matches a subset of attributes and anything when nothing is wanted', () => {
		expect(markerAttrsMatch(region, undefined)).toBe(true);
		expect(markerAttrsMatch(region, {})).toBe(true);
		expect(markerAttrsMatch(region, { source: 'a' })).toBe(true);
		expect(markerAttrsMatch(region, { source: 'a', title: 't' })).toBe(true);
	});
	it('rejects a differing or missing attribute', () => {
		expect(markerAttrsMatch(region, { source: 'b' })).toBe(false);
		expect(markerAttrsMatch(region, { other: 'x' })).toBe(false);
	});
});
