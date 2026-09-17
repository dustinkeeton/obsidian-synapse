export const NO_SPEECH_MESSAGE = 'No speech detected — nothing to transcribe';

/** Transcripts with fewer letters/digits than this are never sent to an AI rewrite. */
export const MIN_TRANSCRIPT_CHARS_FOR_AI = 10;

const NO_SPEECH_ERROR_NAME = 'NoSpeechDetectedError';
const ANNOTATION = /\[[^\]]*\]|\([^)]*\)/g;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const WORD_CHARS = /[\p{L}\p{N}]/gu;

/** Media was transcribed successfully but carries no speech; callers notify and write nothing. */
export class NoSpeechDetectedError extends Error {
	constructor(message: string = NO_SPEECH_MESSAGE) {
		super(message);
		this.name = NO_SPEECH_ERROR_NAME;
	}
}

/** True when `error` or anything in its `cause` chain is a {@link NoSpeechDetectedError}. */
export function isNoSpeechError(error: unknown): boolean {
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (current instanceof Error && !seen.has(current)) {
		if (current.name === NO_SPEECH_ERROR_NAME) return true;
		seen.add(current);
		current = (current as { cause?: unknown }).cause;
	}
	return false;
}

/** False for blank text and for text made only of non-speech annotations like `[Music]` or `♪`. */
export function hasSpeechContent(text: string): boolean {
	return WORD_CHAR.test(text.replace(ANNOTATION, ' '));
}

/** False when `text` is too short for an AI rewrite to do anything but invent content. */
export function isWorthPostProcessing(text: string): boolean {
	if (!hasSpeechContent(text)) return false;
	return (text.match(WORD_CHARS)?.length ?? 0) >= MIN_TRANSCRIPT_CHARS_FOR_AI;
}

export function noSpeechNotice(subject?: string): string {
	return subject
		? `No speech detected in ${subject} — nothing to transcribe`
		: NO_SPEECH_MESSAGE;
}
