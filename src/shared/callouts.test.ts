import { describe, it, expect } from 'vitest';
import { buildCallout, CALLOUT_TYPES } from './callouts';

describe('CALLOUT_TYPES', () => {
	it('has all expected types', () => {
		expect(CALLOUT_TYPES.summary).toBe('synapse-summary');
		expect(CALLOUT_TYPES.transcription).toBe('synapse-transcription');
		expect(CALLOUT_TYPES.enrichment).toBe('synapse-enrichment');
		expect(CALLOUT_TYPES.elaboration).toBe('synapse-elaboration');
		expect(CALLOUT_TYPES.deepDive).toBe('synapse-deep-dive');
		expect(CALLOUT_TYPES.nav).toBe('synapse-nav');
	});
});

describe('buildCallout', () => {
	it('builds a basic callout', () => {
		const result = buildCallout(CALLOUT_TYPES.summary, 'My Title', 'Body text');
		expect(result).toBe([
			'',
			'> [!synapse-summary] My Title',
			'> Body text',
			'',
		].join('\n'));
	});

	it('builds a collapsed callout', () => {
		const result = buildCallout(CALLOUT_TYPES.transcription, 'Title', 'Content', true);
		expect(result).toContain('> [!synapse-transcription]- Title');
	});

	it('handles multi-line body', () => {
		const body = 'Line 1\nLine 2\nLine 3';
		const result = buildCallout(CALLOUT_TYPES.enrichment, 'Related', body);
		const lines = result.split('\n');
		expect(lines[1]).toBe('> [!synapse-enrichment] Related');
		expect(lines[2]).toBe('> Line 1');
		expect(lines[3]).toBe('> Line 2');
		expect(lines[4]).toBe('> Line 3');
	});

	it('has leading and trailing blank lines', () => {
		const result = buildCallout(CALLOUT_TYPES.summary, 'T', 'B');
		expect(result.startsWith('\n')).toBe(true);
		expect(result.endsWith('\n')).toBe(true);
	});

	it('defaults to non-collapsed', () => {
		const result = buildCallout(CALLOUT_TYPES.elaboration, 'Title', 'Body');
		expect(result).toContain('> [!synapse-elaboration] Title');
		expect(result).not.toContain(']-');
	});
});
