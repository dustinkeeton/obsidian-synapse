import { describe, it, expect } from 'vitest';
import {
	NoSpeechDetectedError,
	NO_SPEECH_MESSAGE,
	hasSpeechContent,
	isNoSpeechError,
	isWorthPostProcessing,
	noSpeechNotice,
} from './no-speech';

describe('NoSpeechDetectedError', () => {
	it('carries a stable name and the default message', () => {
		const error = new NoSpeechDetectedError();
		expect(error.name).toBe('NoSpeechDetectedError');
		expect(error.message).toBe(NO_SPEECH_MESSAGE);
		expect(error).toBeInstanceOf(Error);
	});
});

describe('isNoSpeechError', () => {
	it('matches the error itself', () => {
		expect(isNoSpeechError(new NoSpeechDetectedError())).toBe(true);
	});

	it('matches through a cause chain', () => {
		const wrapped = new Error('Video transcription failed');
		(wrapped as { cause?: unknown }).cause = new NoSpeechDetectedError();
		expect(isNoSpeechError(wrapped)).toBe(true);
	});

	it('rejects other errors and non-errors', () => {
		expect(isNoSpeechError(new Error('Whisper API request failed (status 500)'))).toBe(false);
		expect(isNoSpeechError('No speech detected')).toBe(false);
		expect(isNoSpeechError(undefined)).toBe(false);
	});

	it('terminates on a cyclic cause chain', () => {
		const a = new Error('a');
		const b = new Error('b');
		(a as { cause?: unknown }).cause = b;
		(b as { cause?: unknown }).cause = a;
		expect(isNoSpeechError(a)).toBe(false);
	});
});

describe('hasSpeechContent', () => {
	it.each(['', '   ', '\n\t', '...', '♪♪', '[Music]', '(upbeat music)', '[BLANK_AUDIO] ♪ (applause)'])(
		'is false for %j',
		(text) => {
			expect(hasSpeechContent(text)).toBe(false);
		}
	);

	it.each(['Hi.', 'Thank you.', '[Music] Hello there', '你好', '42'])('is true for %j', (text) => {
		expect(hasSpeechContent(text)).toBe(true);
	});
});

describe('isWorthPostProcessing', () => {
	it.each(['', '   ', '[Music]', 'Hi.', 'Thank you.'])('is false for %j', (text) => {
		expect(isWorthPostProcessing(text)).toBe(false);
	});

	it.each(['short transcript', 'Thanks for watching, see you next time.'])('is true for %j', (text) => {
		expect(isWorthPostProcessing(text)).toBe(true);
	});
});

describe('noSpeechNotice', () => {
	it('names the subject when given one', () => {
		expect(noSpeechNotice('memo.mp3')).toBe('No speech detected in memo.mp3 — nothing to transcribe');
	});

	it('falls back to the generic message', () => {
		expect(noSpeechNotice()).toBe(NO_SPEECH_MESSAGE);
	});
});
