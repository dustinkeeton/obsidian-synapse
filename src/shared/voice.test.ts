import { describe, it, expect } from 'vitest';
import {
	voiceInstruction,
	VOICE_OPTIONS,
	NEUTRAL_VOICE_RULE,
	MATCH_NOTE_VOICE_RULE,
	FIRST_PERSON_VOICE_RULE,
	VERBATIM_EXEMPTION_RULE,
} from './voice';
import type { VoiceMode } from './voice';

describe('voiceInstruction (#540)', () => {
	it('neutral forbids first-person authorship and names the author in the third person', () => {
		const out = voiceInstruction({ voice: 'neutral', voiceCustom: '' });
		expect(out.startsWith(NEUTRAL_VOICE_RULE)).toBe(true);
		expect(out).toContain('Never use "I", "me", "my", "we" or "our" as the author');
		expect(out).toContain('"the author"');
	});

	it('match-note mirrors the note but never asserts on the author\'s behalf', () => {
		const out = voiceInstruction({ voice: 'match-note', voiceCustom: '' });
		expect(out.startsWith(MATCH_NOTE_VOICE_RULE)).toBe(true);
		expect(out).toContain('never assert opinions, experiences or intentions');
	});

	it('first-person writes as the author', () => {
		const out = voiceInstruction({ voice: 'first-person', voiceCustom: '' });
		expect(out.startsWith(FIRST_PERSON_VOICE_RULE)).toBe(true);
		expect(out).not.toContain(NEUTRAL_VOICE_RULE);
	});

	it('custom appends the trimmed user text verbatim', () => {
		const out = voiceInstruction({ voice: 'custom', voiceCustom: '  Write like a field guide.  ' });
		expect(out).toBe(`Write like a field guide. ${VERBATIM_EXEMPTION_RULE}`);
	});

	it('custom with blank text falls back to neutral', () => {
		expect(voiceInstruction({ voice: 'custom', voiceCustom: '   ' })).toBe(
			voiceInstruction({ voice: 'neutral', voiceCustom: '' })
		);
	});

	it('an unknown persisted value falls back to neutral', () => {
		expect(voiceInstruction({ voice: 'pirate' as VoiceMode, voiceCustom: '' })).toBe(
			voiceInstruction({ voice: 'neutral', voiceCustom: '' })
		);
	});

	it.each(Object.keys(VOICE_OPTIONS) as VoiceMode[])('%s always ends with the verbatim exemption', (voice) => {
		const out = voiceInstruction({ voice, voiceCustom: 'Be terse.' });
		expect(out.endsWith(VERBATIM_EXEMPTION_RULE)).toBe(true);
		expect(out).toContain('transcripts, direct quotes, song lyrics, poetry, code, chat logs');
	});
});
