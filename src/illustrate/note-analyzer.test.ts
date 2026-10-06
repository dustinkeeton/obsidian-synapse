import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseSpots, NoteAnalyzer } from './note-analyzer';
import { AIClient } from '../shared';
import { DEFAULT_SETTINGS } from '../settings';

const photo = { kind: 'photo', anchor: '## Habitat', caption: 'A red panda', rationale: 'concrete subject', query: 'red panda' };
const diagram = { kind: 'diagram', anchor: 'The lifecycle has', caption: 'Lifecycle', rationale: 'process', mermaid: 'flowchart TD\n A --> B' };
const chart = { kind: 'chart', anchor: '## Population', caption: 'Counts', rationale: 'numbers', chart: { title: 'Pop', xLabels: ['2020'], series: [{ values: [3] }] } };

describe('parseSpots', () => {
	it('parses all three spot kinds from fenced JSON', () => {
		const spots = parseSpots('```json\n' + JSON.stringify({ spots: [photo, diagram, chart] }) + '\n```', 5);
		expect(spots.map(s => s.kind)).toEqual(['photo', 'diagram', 'chart']);
		expect(spots[2]).toMatchObject({ chart: { title: 'Pop' } });
	});

	it('drops malformed entries instead of throwing', () => {
		const bad = [
			{ kind: 'photo', anchor: 'x', caption: 'y' },
			{ kind: 'diagram', anchor: 'x', caption: 'y', mermaid: 'not a diagram' },
			{ kind: 'chart', anchor: 'x', caption: 'y', chart: { title: 'T', xLabels: ['a'], series: [{ values: [1, 2] }] } },
			{ kind: 'video', anchor: 'x', caption: 'y' },
			'junk',
		];
		expect(parseSpots(JSON.stringify({ spots: [...bad, photo] }), 5)).toHaveLength(1);
	});

	it('dedupes anchors and respects the cap', () => {
		const spots = parseSpots(JSON.stringify({ spots: [photo, { ...photo, query: 'other' }, diagram, chart] }), 2);
		expect(spots).toHaveLength(2);
		expect(spots[1].kind).toBe('diagram');
	});

	it('returns an empty list for non-JSON or missing spots', () => {
		expect(parseSpots('no visuals needed', 3)).toEqual([]);
		expect(parseSpots('{"spots": "nope"}', 3)).toEqual([]);
		expect(parseSpots('{"spots": [', 3)).toEqual([]);
	});

	it('drops diagram and chart spots when Mermaid is not allowed (#549)', () => {
		const spots = parseSpots(JSON.stringify({ spots: [diagram, chart, photo] }), 5, { mermaid: false });
		expect(spots.map(s => s.kind)).toEqual(['photo']);
	});

	it('does not let a dropped Mermaid spot consume the cap or its anchor', () => {
		const spots = parseSpots(JSON.stringify({ spots: [diagram, { ...photo, anchor: diagram.anchor }] }), 1, { mermaid: false });
		expect(spots).toHaveLength(1);
		expect(spots[0]).toMatchObject({ kind: 'photo', anchor: diagram.anchor });
	});
});

describe('NoteAnalyzer', () => {
	afterEach(() => vi.restoreAllMocks());

	it('sends the fenced note body and caps spots at maxItemsPerNote', async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.illustrate.maxItemsPerNote = 1;
		const complete = vi.spyOn(AIClient.prototype, 'complete')
			.mockResolvedValue(JSON.stringify({ spots: [photo, diagram] }));
		const analyzer = new NoteAnalyzer(() => settings);
		const spots = await analyzer.analyze('notes/a.md', 'Body text', { onCacheHit: () => {} });
		expect(spots).toHaveLength(1);
		expect(complete.mock.calls[0][0]).toContain('Body text');
		expect(complete.mock.calls[0][0]).toContain('at most 1');
		expect(complete.mock.calls[0][1]).toContain('Respond with JSON only');
	});

	it('asks only for photos and drops model-emitted Mermaid spots when the toggle is off (#549)', async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.illustrate.mermaid = false;
		const complete = vi.spyOn(AIClient.prototype, 'complete')
			.mockResolvedValue(JSON.stringify({ spots: [diagram, chart, photo] }));
		const analyzer = new NoteAnalyzer(() => settings);
		const spots = await analyzer.analyze('notes/a.md', 'Body text');
		expect(spots.map(s => s.kind)).toEqual(['photo']);
		const system = complete.mock.calls[0][1] as string;
		expect(system).toContain('"kind":"photo"');
		expect(system).not.toContain('"diagram"');
		expect(system).not.toContain('"chart"');
		expect(system).not.toContain('mermaid');
		expect(system).toContain('Respond with JSON only');
	});

	it('asks for all three kinds when the toggle is on', async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.illustrate.mermaid = true;
		const complete = vi.spyOn(AIClient.prototype, 'complete')
			.mockResolvedValue(JSON.stringify({ spots: [diagram, chart, photo] }));
		const analyzer = new NoteAnalyzer(() => settings);
		const spots = await analyzer.analyze('notes/a.md', 'Body text');
		expect(spots.map(s => s.kind)).toEqual(['diagram', 'chart', 'photo']);
		const system = complete.mock.calls[0][1] as string;
		expect(system).toContain('"kind":"photo"|"diagram"|"chart"');
		expect(system).toContain('"mermaid":');
		expect(system).toContain('"chart": ONLY when the note itself contains the numbers');
	});
});
