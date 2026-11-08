import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { requestUrl, type RequestUrlResponse } from '../__mocks__/obsidian';
import { ApiRequestError, RequestTimeoutError, safeRequest } from './safe-request';

const mockRequestUrl = vi.mocked(requestUrl) as unknown as Mock<() => Promise<RequestUrlResponse>>;

const ok = { status: 200, json: { ok: true }, text: '{"ok":true}' } as unknown as RequestUrlResponse;

class FakeDocument extends EventTarget {
	visibilityState: 'visible' | 'hidden' = 'visible';
	setVisibility(state: 'visible' | 'hidden'): void {
		this.visibilityState = state;
		this.dispatchEvent(new Event('visibilitychange'));
	}
}

describe('safeRequest network resilience', () => {
	let doc: FakeDocument;

	beforeEach(() => {
		vi.useFakeTimers();
		mockRequestUrl.mockReset();
		doc = new FakeDocument();
		vi.stubGlobal('document', doc);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('retries a dropped connection and succeeds', async () => {
		mockRequestUrl.mockRejectedValueOnce(new Error('The network connection was lost.')).mockResolvedValueOnce(ok);

		const pending = safeRequest({ url: 'https://api.example.com' });
		await vi.runAllTimersAsync();

		await expect(pending).resolves.toBe(ok);
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('waits for the app to return to the foreground before retrying', async () => {
		mockRequestUrl.mockImplementationOnce(async () => {
			doc.setVisibility('hidden');
			throw new Error('The network connection was lost.');
		}).mockResolvedValueOnce(ok);

		const pending = safeRequest({ url: 'https://api.example.com' });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);

		doc.setVisibility('visible');
		await vi.runAllTimersAsync();

		await expect(pending).resolves.toBe(ok);
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('gives up after the bounded retries with the transport error', async () => {
		mockRequestUrl.mockRejectedValue(new Error('offline'));

		const pending = safeRequest({ url: 'https://api.example.com' }).catch((e: unknown) => e);
		await vi.runAllTimersAsync();

		expect(((await pending) as Error).message).toBe('offline');
		expect(mockRequestUrl).toHaveBeenCalledTimes(3);
	});

	it('retries a timeout only when the app was backgrounded during the attempt', async () => {
		mockRequestUrl.mockImplementationOnce(() => {
			doc.setVisibility('hidden');
			doc.setVisibility('visible');
			return new Promise(() => undefined);
		}).mockResolvedValueOnce(ok);

		const pending = safeRequest({ url: 'https://api.example.com' }, 1_000);
		await vi.runAllTimersAsync();

		await expect(pending).resolves.toBe(ok);
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	it('does not retry a foreground timeout', async () => {
		mockRequestUrl.mockReturnValue(new Promise(() => undefined));

		const pending = safeRequest({ url: 'https://api.example.com' }, 1_000).catch((e: unknown) => e);
		await vi.runAllTimersAsync();

		expect(await pending).toBeInstanceOf(RequestTimeoutError);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	it('does not retry an HTTP error', async () => {
		mockRequestUrl.mockResolvedValue({ status: 500, json: { error: { message: 'boom' } }, text: '' } as unknown as RequestUrlResponse);

		const err = await safeRequest({ url: 'https://api.example.com' }).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(ApiRequestError);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});
});
