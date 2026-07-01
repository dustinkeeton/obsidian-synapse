import { describe, it, expect, vi } from 'vitest';
import { reviewAction } from './review-action';

describe('reviewAction — centralized Review-button gate (#366)', () => {
	const baseOpen = () => {};

	it('returns a Review action when something was generated and auto-accept is off', () => {
		const action = reviewAction({
			generated: true,
			shouldAutoAccept: () => false,
			openProposalView: baseOpen,
		});
		// `expect.any(Function)` is an asymmetric matcher (typed `any`); a typed
		// intermediate lands it in an `unknown` slot (any→unknown is safe) without
		// an unnecessary cast.
		const expected: { label: string; onClick: unknown } = {
			label: 'Review',
			onClick: expect.any(Function),
		};
		expect(action).toEqual(expected);
	});

	it('returns undefined when auto-accept is ON (nothing left to review)', () => {
		const action = reviewAction({
			generated: true,
			shouldAutoAccept: () => true,
			openProposalView: baseOpen,
		});
		expect(action).toBeUndefined();
	});

	it('returns undefined when nothing was generated', () => {
		const action = reviewAction({
			generated: false,
			shouldAutoAccept: () => false,
			openProposalView: baseOpen,
		});
		expect(action).toBeUndefined();
	});

	it('returns undefined for an automatic post-op side effect, even with auto-accept off', () => {
		const action = reviewAction({
			generated: true,
			shouldAutoAccept: () => false,
			openProposalView: baseOpen,
			postOp: true,
		});
		expect(action).toBeUndefined();
	});

	it('reads the auto-accept flag live through the accessor each call', () => {
		let auto = false;
		const opts = {
			generated: true,
			shouldAutoAccept: () => auto,
			openProposalView: baseOpen,
		};
		expect(reviewAction(opts)).toBeDefined();
		auto = true;
		expect(reviewAction(opts)).toBeUndefined();
	});

	it("the action's onClick opens the unified proposal view", () => {
		const open = vi.fn();
		const action = reviewAction({
			generated: true,
			shouldAutoAccept: () => false,
			openProposalView: open,
		});
		action!.onClick();
		expect(open).toHaveBeenCalledTimes(1);
	});

	it('tolerates a null openProposalView (not yet wired) without throwing', () => {
		const action = reviewAction({
			generated: true,
			shouldAutoAccept: () => false,
			openProposalView: null,
		});
		expect(() => action!.onClick()).not.toThrow();
	});
});
