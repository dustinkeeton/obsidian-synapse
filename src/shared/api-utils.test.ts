import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	classifyNetworkError,
	describeNetworkError,
	isTransientNetworkError,
	notifyError,
	withRetry,
} from './api-utils';

describe('classifyNetworkError', () => {
	it('classifies Electron net::ERR_CONNECTION_REFUSED as connection-refused', () => {
		expect(classifyNetworkError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe('connection-refused');
	});

	it('classifies Node ECONNREFUSED as connection-refused', () => {
		expect(classifyNetworkError(new Error('connect ECONNREFUSED 127.0.0.1:443'))).toBe('connection-refused');
	});

	it('classifies ENOTFOUND as dns', () => {
		expect(classifyNetworkError(new Error('ENOTFOUND api.openai.com'))).toBe('dns');
	});

	it('classifies getaddrinfo ENOTFOUND as dns', () => {
		expect(classifyNetworkError(new Error('getaddrinfo ENOTFOUND api.deepgram.com'))).toBe('dns');
	});

	it('classifies ETIMEDOUT as timeout', () => {
		expect(classifyNetworkError(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toBe('timeout');
	});

	it('classifies net::ERR_CONNECTION_TIMED_OUT as timeout', () => {
		expect(classifyNetworkError(new Error('net::ERR_CONNECTION_TIMED_OUT'))).toBe('timeout');
	});

	it('returns null for a plain HTTP 500 string', () => {
		expect(classifyNetworkError('HTTP 500')).toBeNull();
	});

	it('accepts a bare string message, not only Error instances', () => {
		expect(classifyNetworkError('Connection refused')).toBe('connection-refused');
	});
});

describe('isTransientNetworkError', () => {
	it('is true for a network error', () => {
		expect(isTransientNetworkError(new Error('ECONNREFUSED'))).toBe(true);
	});

	it('is false for a non-network error', () => {
		expect(isTransientNetworkError(new Error('HTTP 500'))).toBe(false);
	});
});

describe('describeNetworkError', () => {
	it('returns a non-null message naming the resource for a network error', () => {
		const msg = describeNetworkError(new Error('net::ERR_CONNECTION_REFUSED'), 'the Whisper transcription API');
		expect(msg).not.toBeNull();
		expect(msg).toContain('the Whisper transcription API');
		expect(msg!.toLowerCase()).toContain('connection refused');
	});

	it('returns null for a non-network error', () => {
		expect(describeNetworkError(new Error('HTTP 500'), 'the API')).toBeNull();
	});
});

describe('withRetry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('calls fn exactly once and rethrows when shouldRetry returns false', async () => {
		const err = new Error('non-retryable');
		const fn = vi.fn().mockRejectedValue(err);

		await expect(withRetry(fn, 3, 0, () => false)).rejects.toThrow('non-retryable');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries up to maxRetries when shouldRetry returns true', async () => {
		const err = new Error('always fails');
		const fn = vi.fn().mockRejectedValue(err);

		const promise = withRetry(fn, 3, 0, () => true);
		// Attach a rejection handler immediately so the rejection is observed.
		const expectation = expect(promise).rejects.toThrow('always fails');
		await vi.runAllTimersAsync();
		await expectation;
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('succeeds on a later attempt after transient failures', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('transient 1'))
			.mockRejectedValueOnce(new Error('transient 2'))
			.mockResolvedValue('ok');

		const promise = withRetry(fn, 3, 1000, () => true);
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toBe('ok');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('defaults to retrying everything when no predicate is supplied (backward compatible)', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('transient'))
			.mockResolvedValue('done');

		const promise = withRetry(fn, 2, 0);
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toBe('done');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe('notifyError redaction', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	const loggedMessage = () => String(errorSpy.mock.calls[0]?.[1] ?? '');

	it('redacts Google AIza… keys (the gap the old inline regex missed)', () => {
		notifyError('Gemini call failed', new Error('API key not valid: AIzaSyBadKey1234567890123456789012345'));
		const msg = loggedMessage();
		expect(msg).toContain('[REDACTED]');
		expect(msg).not.toContain('AIzaSyBadKey');
	});

	it('redacts OpenAI sk- keys and Bearer tokens', () => {
		notifyError('OpenAI call failed', new Error('rejected key sk-abcdef1234567890 via Bearer abcdefgh12345678'));
		const msg = loggedMessage();
		expect(msg).not.toContain('sk-abcdef1234567890');
		expect(msg).not.toContain('abcdefgh12345678');
		expect(msg).toContain('[REDACTED]');
	});

	it('leaves non-secret error text intact', () => {
		notifyError('Parse failed', new Error('Unexpected token at position 12'));
		expect(loggedMessage()).toContain('Unexpected token at position 12');
	});
});
