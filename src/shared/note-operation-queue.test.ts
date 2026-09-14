import { describe, it, expect, vi } from 'vitest';
import { NoteOperationQueue } from './note-operation-queue';

/** A promise plus its resolver, for deterministic ordering without timers. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

describe('NoteOperationQueue', () => {
	it('runs a single operation immediately and returns its value', async () => {
		const queue = new NoteOperationQueue();
		await expect(queue.run('note.md', async () => 42)).resolves.toBe(42);
		expect(queue.isBusy('note.md')).toBe(false);
		expect(queue.size).toBe(0);
	});

	it('serializes operations on the same note in submission order', async () => {
		const queue = new NoteOperationQueue();
		const order: string[] = [];
		const first = deferred();

		const a = queue.run('note.md', async () => {
			order.push('a:start');
			await first.promise;
			order.push('a:end');
		});
		const b = queue.run('note.md', async () => {
			order.push('b:start');
			order.push('b:end');
		});

		// b must not have started while a is still in flight.
		await Promise.resolve();
		expect(order).toEqual(['a:start']);

		first.resolve();
		await Promise.all([a, b]);
		expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
	});

	it('reads the state written by the previous operation (no lost update)', async () => {
		const queue = new NoteOperationQueue();
		let content = 'body';
		const slow = deferred();

		const writer = queue.run('note.md', async () => {
			const snapshot = content;
			await slow.promise;           // long "AI call"
			content = snapshot + '\ntranscript';
		});
		const reader = queue.run('note.md', async () => content);

		slow.resolve();
		await writer;
		await expect(reader).resolves.toBe('body\ntranscript');
	});

	it('does not serialize operations on different notes', async () => {
		const queue = new NoteOperationQueue();
		const order: string[] = [];
		const blocked = deferred();

		const a = queue.run('a.md', async () => {
			order.push('a:start');
			await blocked.promise;
			order.push('a:end');
		});
		const b = queue.run('b.md', async () => { order.push('b'); });

		await b;
		expect(order).toEqual(['a:start', 'b']);

		blocked.resolve();
		await a;
	});

	it('releases the note after a rejecting operation and keeps the queue running', async () => {
		const queue = new NoteOperationQueue();
		const failure = queue.run('note.md', async () => { throw new Error('boom'); });
		const followUp = queue.run('note.md', async () => 'ok');

		await expect(failure).rejects.toThrow('boom');
		await expect(followUp).resolves.toBe('ok');
		expect(queue.isBusy('note.md')).toBe(false);
	});

	it('calls onWait only when the operation actually has to wait', async () => {
		const queue = new NoteOperationQueue();
		const blocked = deferred();
		const firstWait = vi.fn();
		const secondWait = vi.fn();

		const a = queue.run('note.md', () => blocked.promise, { onWait: firstWait });
		const b = queue.run('note.md', async () => undefined, { onWait: secondWait });

		expect(firstWait).not.toHaveBeenCalled();
		expect(secondWait).toHaveBeenCalledTimes(1);

		blocked.resolve();
		await Promise.all([a, b]);

		// A later, uncontended submission does not report a wait.
		const thirdWait = vi.fn();
		await queue.run('note.md', async () => undefined, { onWait: thirdWait });
		expect(thirdWait).not.toHaveBeenCalled();
	});

	it('reports busy state while an operation is in flight', async () => {
		const queue = new NoteOperationQueue();
		const blocked = deferred();

		const running = queue.run('note.md', () => blocked.promise);
		expect(queue.isBusy('note.md')).toBe(true);
		expect(queue.isBusy('other.md')).toBe(false);

		blocked.resolve();
		await running;
		expect(queue.isBusy('note.md')).toBe(false);
	});

	it('drains a burst of concurrent submissions in order', async () => {
		const queue = new NoteOperationQueue();
		const seen: number[] = [];
		let running = 0;

		await Promise.all(
			[0, 1, 2, 3, 4].map((i) =>
				queue.run('note.md', async () => {
					running++;
					expect(running).toBe(1);   // never overlapping
					await Promise.resolve();
					seen.push(i);
					running--;
				})
			)
		);

		expect(seen).toEqual([0, 1, 2, 3, 4]);
		expect(queue.size).toBe(0);
	});
});
