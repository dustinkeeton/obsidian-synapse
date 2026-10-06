import { describe, it, expect } from 'vitest';
import {
	buildCallout, CALLOUT_TYPES, CALLOUT_BASES, calloutForTranscriptionResult,
	calloutHeaderToken, calloutHeaderLine, calloutHeaderSource, calloutIdentity, parseCalloutHeader, isCalloutHeader, hasCallout,
} from './callouts';

describe('CALLOUT_TYPES', () => {
	it('has all expected types', () => {
		expect(CALLOUT_TYPES.summary).toBe('synapse-summary');
		expect(CALLOUT_TYPES.transcription).toBe('synapse-transcription');
		expect(CALLOUT_TYPES.lyrics).toBe('synapse-lyrics');
		expect(CALLOUT_TYPES.verse).toBe('synapse-verse');
		expect(CALLOUT_TYPES.chorus).toBe('synapse-chorus');
		expect(CALLOUT_TYPES.enrichment).toBe('synapse-enrichment');
		expect(CALLOUT_TYPES.elaboration).toBe('synapse-elaboration');
		expect(CALLOUT_TYPES.deepDive).toBe('synapse-deep-dive');
		expect(CALLOUT_TYPES.nav).toBe('synapse-nav');
	});
});

describe('CALLOUT_BASES', () => {
	it('gives every registered type a base', () => {
		for (const type of Object.values(CALLOUT_TYPES)) {
			expect(['note', 'summary', 'info', 'quote']).toContain(CALLOUT_BASES[type]);
		}
	});

	it('maps the natural analogues and defaults the rest to note', () => {
		expect(CALLOUT_BASES['synapse-summary']).toBe('summary');
		expect(CALLOUT_BASES['synapse-enrichment']).toBe('info');
		expect(CALLOUT_BASES['synapse-transcription']).toBe('quote');
		expect(CALLOUT_BASES['synapse-lyrics']).toBe('quote');
		expect(CALLOUT_BASES['synapse-ocr']).toBe('quote');
		expect(CALLOUT_BASES['synapse-deep-dive']).toBe('note');
		expect(CALLOUT_BASES['synapse-nav']).toBe('note');
		expect(CALLOUT_BASES['synapse-illustrate']).toBe('note');
		expect(CALLOUT_BASES['synapse-elaboration']).toBe('note');
	});
});

describe('calloutHeaderToken / calloutHeaderLine', () => {
	it('writes base|identity with the identity as a single lowercase hyphenated token', () => {
		expect(calloutHeaderToken(CALLOUT_TYPES.summary)).toBe('summary|synapse-summary');
		expect(calloutHeaderToken(CALLOUT_TYPES.deepDive)).toBe('note|synapse-deep-dive');
	});

	it('renders the header line with the optional fold marker', () => {
		expect(calloutHeaderLine(CALLOUT_TYPES.nav, 'Deep Dive Navigation')).toBe('> [!note|synapse-nav] Deep Dive Navigation');
		expect(calloutHeaderLine(CALLOUT_TYPES.transcription, 'T', true)).toBe('> [!quote|synapse-transcription]- T');
	});
});

describe('calloutIdentity', () => {
	it('reads the metadata token after the pipe', () => {
		expect(calloutIdentity('quote|synapse-transcription')).toBe('synapse-transcription');
		expect(calloutIdentity('Summary | Synapse-Summary ')).toBe('synapse-summary');
	});

	it('falls back to the bare type for the legacy form', () => {
		expect(calloutIdentity('synapse-summary')).toBe('synapse-summary');
		expect(calloutIdentity('quote')).toBe('quote');
	});
});

describe('parseCalloutHeader / isCalloutHeader / hasCallout', () => {
	it.each([
		{ form: 'new', line: '> [!quote|synapse-transcription]- Transcription of clip.mp4' },
		{ form: 'legacy', line: '> [!synapse-transcription]- Transcription of clip.mp4' },
	])('matches the $form form with its title', ({ line }) => {
		expect(parseCalloutHeader(line)).toEqual({ identity: 'synapse-transcription', title: 'Transcription of clip.mp4' });
		expect(isCalloutHeader(line, CALLOUT_TYPES.transcription)).toBe(true);
		expect(isCalloutHeader(line, CALLOUT_TYPES.lyrics)).toBe(false);
	});

	it('does not confuse the base with the identity', () => {
		expect(isCalloutHeader('> [!summary] My own summary', CALLOUT_TYPES.summary)).toBe(false);
		expect(isCalloutHeader('> [!quote|synapse-ocr] OCR of x.png', CALLOUT_TYPES.transcription)).toBe(false);
	});

	it('accepts nested quote prefixes, indentation and a plus fold marker', () => {
		expect(isCalloutHeader('> > [!note|synapse-illustrate]+ Caption', CALLOUT_TYPES.illustrate)).toBe(true);
		expect(isCalloutHeader('  > [!synapse-illustrate] Caption', CALLOUT_TYPES.illustrate)).toBe(true);
	});

	it('rejects lines that merely mention the token', () => {
		expect(parseCalloutHeader('see [!synapse-summary] in the docs')).toBeNull();
		expect(isCalloutHeader('plain text', CALLOUT_TYPES.summary)).toBe(false);
	});

	it('hasCallout scans every line', () => {
		const content = 'Prose\n\n> [!note|synapse-illustrate] Caption\n> Source: x';
		expect(hasCallout(content, CALLOUT_TYPES.illustrate)).toBe(true);
		expect(hasCallout(content.replace('note|', ''), CALLOUT_TYPES.illustrate)).toBe(true);
		expect(hasCallout(content, CALLOUT_TYPES.summary)).toBe(false);
	});
});

describe('calloutHeaderSource', () => {
	it('builds a regex fragment that matches both spellings and nothing else', () => {
		const re = new RegExp(`^> ${calloutHeaderSource(CALLOUT_TYPES.enrichment)}`);
		expect(re.test('> [!info|synapse-enrichment] References')).toBe(true);
		expect(re.test('> [!synapse-enrichment] References')).toBe(true);
		expect(re.test('> [!info] References')).toBe(false);
		expect(re.test('> [!info|synapse-enrichment-extra] References')).toBe(false);
	});
});

describe('calloutForTranscriptionResult', () => {
	it('uses the lyrics callout and verb when a lyrics schema reformatted the transcript', () => {
		const result = calloutForTranscriptionResult({ reformatted: true, schemaId: 'lyrics' });
		expect(result.type).toBe(CALLOUT_TYPES.lyrics);
		expect(result.verb).toBe('Lyrics of');
	});

	it('uses the transcription callout and verb for an unreformatted transcript', () => {
		const result = calloutForTranscriptionResult({});
		expect(result.type).toBe(CALLOUT_TYPES.transcription);
		expect(result.verb).toBe('Transcription of');
	});

	it('falls back to transcription for an unknown schema id', () => {
		const result = calloutForTranscriptionResult({ reformatted: true, schemaId: 'recipe' });
		expect(result.type).toBe(CALLOUT_TYPES.transcription);
		expect(result.verb).toBe('Transcription of');
	});
});

describe('buildCallout', () => {
	it('builds a basic callout on its native base', () => {
		const result = buildCallout(CALLOUT_TYPES.summary, 'My Title', 'Body text');
		expect(result).toBe([
			'',
			'> [!summary|synapse-summary] My Title',
			'> Body text',
			'',
		].join('\n'));
	});

	it('builds a collapsed callout', () => {
		const result = buildCallout(CALLOUT_TYPES.transcription, 'Title', 'Content', true);
		expect(result).toContain('> [!quote|synapse-transcription]- Title');
	});

	it('handles multi-line body', () => {
		const body = 'Line 1\nLine 2\nLine 3';
		const result = buildCallout(CALLOUT_TYPES.enrichment, 'Related', body);
		const lines = result.split('\n');
		expect(lines[1]).toBe('> [!info|synapse-enrichment] Related');
		expect(lines[2]).toBe('> Line 1');
		expect(lines[3]).toBe('> Line 2');
		expect(lines[4]).toBe('> Line 3');
	});

	it('has leading and trailing blank lines', () => {
		const result = buildCallout(CALLOUT_TYPES.summary, 'T', 'B');
		expect(result.startsWith('\n')).toBe(true);
		expect(result.endsWith('\n')).toBe(true);
	});

	it('defaults to non-collapsed and to the note base', () => {
		const result = buildCallout(CALLOUT_TYPES.elaboration, 'Title', 'Body');
		expect(result).toContain('> [!note|synapse-elaboration] Title');
		expect(result).not.toContain(']-');
	});

	it('round-trips through the matcher', () => {
		const header = buildCallout(CALLOUT_TYPES.ocr, 'OCR of x.png', 'text', true).split('\n')[1];
		expect(isCalloutHeader(header, CALLOUT_TYPES.ocr)).toBe(true);
		expect(parseCalloutHeader(header)?.title).toBe('OCR of x.png');
	});
});
