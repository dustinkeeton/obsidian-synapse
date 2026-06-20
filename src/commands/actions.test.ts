import { describe, it, expect } from 'vitest';
import { listPaletteActions } from './actions';

describe('listPaletteActions', () => {
	it('returns the registered entries in registry order (not set-insertion order)', () => {
		// Set built in a deliberately scrambled order; output must follow COMMAND_REGISTRY.
		const registered = new Set(['deep-dive', 'fire', 'review-proposals']);
		const result = listPaletteActions(registered);
		expect(result.map((c) => c.id)).toEqual(['review-proposals', 'fire', 'deep-dive']);
	});

	it('ignores ids that are not registry members', () => {
		const result = listPaletteActions(new Set(['enrich-current-note', 'not-a-real-command']));
		expect(result.map((c) => c.id)).toEqual(['enrich-current-note']);
	});

	it('returns an empty list when nothing is registered', () => {
		expect(listPaletteActions(new Set())).toEqual([]);
	});

	it('returns full command metadata (name, feature, context) for the sidebar to render', () => {
		const [entry] = listPaletteActions(new Set(['enrich-current-note']));
		expect(entry).toMatchObject({
			id: 'enrich-current-note',
			name: 'Enrich current note',
			feature: 'enrichment',
			context: 'note',
		});
	});
});
