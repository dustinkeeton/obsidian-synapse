import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchSidebarCommand, type CommandDispatchHost, type ActivatableLeaf } from './dispatch';

/**
 * A spy host that records the order of `setActiveLeaf` / `executeCommandById`
 * calls so we can assert the #352 ordering: re-activate the note's leaf, let a
 * macrotask elapse, THEN dispatch.
 */
function makeHost(): CommandDispatchHost & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		setActiveLeaf: vi.fn((_leaf: ActivatableLeaf, _o: { focus: boolean }) => {
			calls.push('setActiveLeaf');
		}),
		executeCommandById: vi.fn((_fullId: string) => {
			calls.push('executeCommandById');
			return true;
		}),
	};
}

const noteLeaf: ActivatableLeaf = { view: {} };

describe('dispatchSidebarCommand', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	// Regression for #352: a single (first) dispatch of a `context: 'note'` command
	// must re-activate the editor BEFORE the command runs, with a macrotask between
	// them. The old code dispatched synchronously in the same tick as setActiveLeaf,
	// so the editor wasn't active yet and the command no-op'd until a 2nd click.
	it('re-activates the note leaf, waits a macrotask, then dispatches on the first call', async () => {
		const host = makeHost();

		const promise = dispatchSidebarCommand(host, 'enrich-current-note', 'synapse:enrich-current-note', noteLeaf);

		// Synchronously, only the re-activation has happened — dispatch is deferred to
		// a later macrotask (this is the crux of the fix; sync dispatch is the bug).
		expect(host.setActiveLeaf).toHaveBeenCalledTimes(1);
		expect(host.setActiveLeaf).toHaveBeenCalledWith(noteLeaf, { focus: true });
		expect(host.executeCommandById).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();
		await promise;

		// After a macrotask elapses, the command dispatches — on the FIRST call.
		expect(host.executeCommandById).toHaveBeenCalledTimes(1);
		expect(host.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
		// Ordering: setActiveLeaf strictly precedes executeCommandById.
		expect(host.calls).toEqual(['setActiveLeaf', 'executeCommandById']);
	});

	it('dispatches a non-note command immediately without re-activating any leaf', async () => {
		const host = makeHost();

		// `review-proposals` is a `context: 'global'` command in the registry.
		await dispatchSidebarCommand(host, 'review-proposals', 'synapse:review-proposals', noteLeaf);

		expect(host.setActiveLeaf).not.toHaveBeenCalled();
		expect(host.executeCommandById).toHaveBeenCalledWith('synapse:review-proposals');
		expect(host.calls).toEqual(['executeCommandById']);
	});

	it('dispatches a note command immediately when no markdown leaf is resolvable', async () => {
		const host = makeHost();

		await dispatchSidebarCommand(host, 'enrich-current-note', 'synapse:enrich-current-note', null);

		expect(host.setActiveLeaf).not.toHaveBeenCalled();
		expect(host.executeCommandById).toHaveBeenCalledWith('synapse:enrich-current-note');
	});
});
