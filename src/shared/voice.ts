/** Narrative voice for model-authored prose (#540). */
export type VoiceMode = 'neutral' | 'match-note' | 'first-person' | 'custom';

/** The `ai.voice` / `ai.voiceCustom` slice of settings; kept local so shared/ never imports settings.ts. */
export interface VoiceSettings {
	voice: VoiceMode;
	voiceCustom: string;
}

export const VOICE_OPTIONS: Record<VoiceMode, string> = {
	neutral: 'Neutral (third person)',
	'match-note': 'Match the note',
	'first-person': 'First person (as me)',
	custom: 'Custom',
};

export const NEUTRAL_VOICE_RULE =
	'Write in a neutral, third-person voice. Never use "I", "me", "my", "we" or "our" as the author, and never write as the note\'s author or claim their opinions, experiences or intentions; refer to them, if at all, as "the author".';
export const MATCH_NOTE_VOICE_RULE =
	'Match the register and grammatical person of the surrounding note, but never assert opinions, experiences or intentions on the author\'s behalf.';
export const FIRST_PERSON_VOICE_RULE =
	'Write in the first person as the note\'s author ("I", "my").';
export const VERBATIM_EXEMPTION_RULE =
	'Quoted or transcribed material (transcripts, direct quotes, song lyrics, poetry, code, chat logs) keeps its original wording and voice; apply this voice only to text you write yourself.';

/** System-prompt sentence(s) for the selected voice; unknown modes and blank custom text fall back to neutral. */
export function voiceInstruction(settings: VoiceSettings): string {
	return `${voiceRule(settings)} ${VERBATIM_EXEMPTION_RULE}`;
}

function voiceRule({ voice, voiceCustom }: VoiceSettings): string {
	switch (voice) {
		case 'match-note':
			return MATCH_NOTE_VOICE_RULE;
		case 'first-person':
			return FIRST_PERSON_VOICE_RULE;
		case 'custom': {
			const custom = (voiceCustom ?? '').trim();
			return custom || NEUTRAL_VOICE_RULE;
		}
		default:
			return NEUTRAL_VOICE_RULE;
	}
}
